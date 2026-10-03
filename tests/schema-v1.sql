-- =============================================================================
-- Genesis Hackathon — Supabase backend
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again later (it only adds what is missing and replaces
-- functions), so re-running it is how you apply updates.
--
-- Design:
--   * All tables live in the private schema `genesis`, which the public
--     (anon) key cannot read or write.
--   * The website talks to the database ONLY through the `public.api_*`
--     functions below. Each one checks the caller's session token and role
--     before doing anything, exactly like the Node server did.
--   * Live updates use Supabase Realtime broadcasts on the "genesis" channel.
--     Broadcasts carry only "something changed" signals, never scores,
--     comments or other private data.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists genesis;
revoke all on schema genesis from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists genesis.admins (
  id            bigint generated always as identity primary key,
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists genesis.teams (
  id                    bigint generated always as identity primary key,
  code                  text not null unique,
  name                  text not null,
  leader_name           text not null default '',
  email                 text not null default '',
  phone                 text not null default '',
  members               jsonb not null default '[]'::jsonb,
  track                 text not null default '',
  table_no              text not null default '',
  notes                 text not null default '',
  password_hash         text not null,
  active                boolean not null default true,
  last_login_at         timestamptz,
  announcements_seen_at timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists genesis.rounds (
  id             bigint generated always as identity primary key,
  number         int not null unique,
  name           text not null,
  description    text not null default '',
  is_elimination boolean not null default true,
  state          text not null default 'upcoming' check (state in ('upcoming','live','judging','completed')),
  published      boolean not null default false,
  published_at   timestamptz
);

create table if not exists genesis.criteria (
  id        bigint generated always as identity primary key,
  round_id  bigint not null references genesis.rounds(id) on delete cascade,
  name      text not null,
  max_score numeric not null default 10,
  sort      int not null default 0
);

create table if not exists genesis.scores (
  team_id      bigint not null references genesis.teams(id) on delete cascade,
  criterion_id bigint not null references genesis.criteria(id) on delete cascade,
  score        numeric not null,
  primary key (team_id, criterion_id)
);

create table if not exists genesis.results (
  team_id    bigint not null references genesis.teams(id) on delete cascade,
  round_id   bigint not null references genesis.rounds(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','selected','eliminated')),
  comments   text not null default '',
  award      text not null default '',
  updated_by text,
  updated_at timestamptz,
  primary key (team_id, round_id)
);

create table if not exists genesis.announcements (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null default '',
  priority   text not null default 'normal' check (priority in ('normal','important','urgent')),
  audience   text not null default 'all' check (audience in ('all','competing','team')),
  team_id    bigint references genesis.teams(id) on delete cascade,
  pinned     boolean not null default false,
  author     text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists genesis.tickets (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references genesis.teams(id) on delete cascade,
  category     text not null,
  subject      text not null,
  status       text not null default 'open' check (status in ('open','in_progress','resolved')),
  team_unread  boolean not null default false,
  admin_unread boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists genesis.ticket_messages (
  id          bigint generated always as identity primary key,
  ticket_id   bigint not null references genesis.tickets(id) on delete cascade,
  author_type text not null check (author_type in ('team','admin')),
  author_name text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists genesis.schedule (
  id        bigint generated always as identity primary key,
  title     text not null,
  details   text not null default '',
  location  text not null default '',
  kind      text not null default 'general' check (kind in ('general','round','deadline','food','talk')),
  starts_at timestamptz not null,
  ends_at   timestamptz
);

create table if not exists genesis.settings (
  key   text primary key,
  value text not null
);

create table if not exists genesis.sessions (
  token_hash   text primary key,
  role         text not null check (role in ('admin','team')),
  user_id      bigint not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create table if not exists genesis.login_attempts (
  key      text primary key,
  count    int not null,
  first_at timestamptz not null
);

create index if not exists idx_criteria_round on genesis.criteria(round_id);
create index if not exists idx_results_round on genesis.results(round_id);
create index if not exists idx_tickets_team on genesis.tickets(team_id);
create index if not exists idx_msgs_ticket on genesis.ticket_messages(ticket_id);
create index if not exists idx_sessions_user on genesis.sessions(role, user_id);

-- Default rounds and criteria (only on a fresh database).
do $$
declare rid bigint;
begin
  if not exists (select 1 from genesis.rounds) then
    insert into genesis.rounds (number, name, description, is_elimination) values
      (1, 'Idea review', 'Pitch the problem you picked and how you plan to solve it. Every team moves on to Round 2.', false) returning id into rid;
    insert into genesis.criteria (round_id, name, sort) values (rid, 'Problem understanding', 0), (rid, 'Innovation', 1), (rid, 'Feasibility', 2);
    insert into genesis.rounds (number, name, description, is_elimination) values
      (2, 'Progress check', 'Show what you have built so far and walk the judges through your technical approach.', true) returning id into rid;
    insert into genesis.criteria (round_id, name, sort) values (rid, 'Progress so far', 0), (rid, 'Technical approach', 1), (rid, 'Team coordination', 2);
    insert into genesis.rounds (number, name, description, is_elimination) values
      (3, 'Prototype demo', 'Demo a working prototype. Judges look at what works, not what is planned.', true) returning id into rid;
    insert into genesis.criteria (round_id, name, sort) values (rid, 'Functionality', 0), (rid, 'Technical complexity', 1), (rid, 'Design & usability', 2);
    insert into genesis.rounds (number, name, description, is_elimination) values
      (4, 'Final pitch', 'Final presentation and Q&A in front of the jury.', true) returning id into rid;
    insert into genesis.criteria (round_id, name, sort) values (rid, 'Impact', 0), (rid, 'Completeness', 1), (rid, 'Presentation', 2), (rid, 'Q&A', 3);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not callable from the website)
-- ---------------------------------------------------------------------------

-- Raise an error the website shows as-is. PostgREST maps SQLSTATE PTxxx to HTTP xxx.
create or replace function genesis.fail(p_status int, p_msg text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'PT' || p_status::text, message = p_msg;
end $$;

create or replace function genesis.iso(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create or replace function genesis.sha(p text) returns text
language sql immutable as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function genesis.hash_password(p text, p_cost int default 6) returns text
language sql volatile as $$
  select extensions.crypt(p, extensions.gen_salt('bf', p_cost))
$$;

create or replace function genesis.check_password(p text, p_hash text) returns boolean
language sql stable as $$
  select p_hash is not null and p_hash = extensions.crypt(p, p_hash)
$$;

-- Readable, phone-friendly passwords like "k7qm-x2rp" (no 0/o/1/l/i).
create or replace function genesis.gen_password() returns text
language plpgsql volatile as $$
declare
  a text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea := extensions.gen_random_bytes(8);
  s text := '';
begin
  for i in 0..7 loop
    s := s || substr(a, (get_byte(b, i) % 31) + 1, 1);
    if i = 3 then s := s || '-'; end if;
  end loop;
  return s;
end $$;

create or replace function genesis.settings_json() returns jsonb
language sql stable as $$
  select jsonb_build_object(
      'event_name', 'Genesis Hackathon',
      'tagline', '24 hours to build what comes next.',
      'venue', '', 'event_start', '', 'event_end', '',
      'leaderboard_visible', '0', 'helpdesk_open', '1', 'allow_password_change', '0',
      'helpdesk_contact', '', 'team_code_prefix', 'GEN')
    || coalesce((select jsonb_object_agg(key, value) from genesis.settings), '{}'::jsonb)
$$;

-- Live update signal. Never put private data in the payload: anyone with the
-- public key can listen to this channel.
create or replace function genesis.notify(p_type text, p_data jsonb default '{}'::jsonb, p_target text default 'all') returns void
language plpgsql as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('type', p_type, 'target', p_target, 'data', coalesce(p_data, '{}'::jsonb)),
      'change', 'genesis', false);
  exception when others then
    null; -- Realtime not available: pages fall back to periodic refresh.
  end;
end $$;

-- ---- input validation ----------------------------------------------------------------

create or replace function genesis.txt(p jsonb, k text, label text, maxlen int, required boolean default false, do_trim boolean default true) returns text
language plpgsql as $$
declare v text;
begin
  if p is null or not (p ? k) or jsonb_typeof(p->k) = 'null' then v := '';
  elsif jsonb_typeof(p->k) in ('string', 'number') then v := p->>k;
  else perform genesis.fail(400, label || ' must be text.');
  end if;
  if do_trim then v := btrim(v, E' \t\r\n'); end if;
  if required and v = '' then perform genesis.fail(400, label || ' is required.'); end if;
  if length(v) > maxlen then perform genesis.fail(400, label || ' must be ' || maxlen || ' characters or fewer.'); end if;
  return v;
end $$;

create or replace function genesis.num(p jsonb, k text, label text, lo numeric, hi numeric, nullable boolean default false) returns numeric
language plpgsql as $$
declare n numeric;
begin
  if p is null or not (p ? k) or jsonb_typeof(p->k) = 'null' or (jsonb_typeof(p->k) = 'string' and btrim(p->>k) = '') then
    if nullable then return null; end if;
    perform genesis.fail(400, label || ' must be a number.');
  end if;
  begin
    n := btrim(p->>k)::numeric;
  exception when others then
    perform genesis.fail(400, label || ' must be a number.');
  end;
  if n < lo or n > hi then
    perform genesis.fail(400, label || ' must be between ' || trim_scale(lo) || ' and ' || trim_scale(hi) || '.');
  end if;
  return n;
end $$;

create or replace function genesis.flag(p jsonb, k text) returns boolean
language sql immutable as $$
  select coalesce(p->>k, '') in ('true', '1')
$$;

create or replace function genesis.one_of(v text, opts text[], label text) returns text
language plpgsql as $$
begin
  if v is null or not (v = any(opts)) then
    perform genesis.fail(400, label || ' must be one of: ' || array_to_string(opts, ', ') || '.');
  end if;
  return v;
end $$;

create or replace function genesis.ts(p jsonb, k text, label text, nullable boolean default false) returns timestamptz
language plpgsql as $$
declare t timestamptz;
begin
  if p is null or coalesce(p->>k, '') = '' then
    if nullable then return null; end if;
    perform genesis.fail(400, label || ' is not a valid date and time.');
  end if;
  begin
    t := (p->>k)::timestamptz;
  exception when others then
    perform genesis.fail(400, label || ' is not a valid date and time.');
  end;
  return t;
end $$;

create or replace function genesis.members(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(m) filter (where m <> ''), '[]'::jsonb)
  from (
    select btrim(x) as m from (
      select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as x
      union all
      select regexp_split_to_table(case when jsonb_typeof(p) = 'string' then p #>> '{}' else '' end, E'[;|\n]')
    ) s limit 12
  ) t
$$;

-- ---- sessions ---------------------------------------------------------------------------

create or replace function genesis.auth(p_token text, p_role text default null) returns jsonb
language plpgsql as $$
declare s genesis.sessions; u jsonb;
begin
  if coalesce(p_token, '') = '' then perform genesis.fail(401, 'Your session has ended. Sign in again.'); end if;
  select * into s from genesis.sessions where token_hash = genesis.sha(p_token);
  if not found or s.expires_at < now() then perform genesis.fail(401, 'Your session has ended. Sign in again.'); end if;
  if s.role = 'admin' then
    select jsonb_build_object('role', 'admin', 'id', id, 'username', username, 'name', display_name) into u
      from genesis.admins where id = s.user_id;
  else
    select jsonb_build_object('role', 'team', 'id', id, 'username', code, 'name', name, 'leader', leader_name) into u
      from genesis.teams where id = s.user_id and active;
  end if;
  if u is null then perform genesis.fail(401, 'Your session has ended. Sign in again.'); end if;
  if p_role is not null and u->>'role' <> p_role then perform genesis.fail(403, 'You don’t have access to this.'); end if;
  if s.last_seen_at < now() - interval '5 minutes' then
    update genesis.sessions set last_seen_at = now() where token_hash = s.token_hash;
  end if;
  return u;
end $$;

create or replace function genesis.kick(p_role text, p_user bigint) returns void
language sql as $$
  delete from genesis.sessions where role = p_role and user_id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Rounds, scores and standings (the core rules)
-- ---------------------------------------------------------------------------

create or replace function genesis.round_total(p_round bigint, p_team bigint) returns numeric
language sql stable as $$
  select case when count(s.score) = 0 then null else round(sum(s.score), 2) end
  from genesis.criteria c
  join genesis.scores s on s.criterion_id = c.id and s.team_id = p_team
  where c.round_id = p_round
$$;

create or replace function genesis.round_complete(p_round bigint, p_team bigint) returns boolean
language sql stable as $$
  select count(*) > 0 and count(s.score) = count(*)
  from genesis.criteria c
  left join genesis.scores s on s.criterion_id = c.id and s.team_id = p_team
  where c.round_id = p_round
$$;

create or replace function genesis.effective_status(p_is_elim boolean, p_status text) returns text
language sql immutable as $$
  select case when p_status = 'eliminated' then 'eliminated'
              when not p_is_elim then 'advanced'
              else coalesce(p_status, 'pending') end
$$;

-- First round number in which the team was eliminated (optionally only counting
-- published rounds, or only rounds before a given number).
create or replace function genesis.eliminated_in(p_team bigint, p_published_only boolean, p_before int default null) returns int
language sql stable as $$
  select min(r.number) from genesis.results res
  join genesis.rounds r on r.id = res.round_id
  where res.team_id = p_team and res.status = 'eliminated'
    and (not p_published_only or r.published)
    and (p_before is null or r.number < p_before)
$$;

create or replace function genesis.round_json(p_id bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'number', r.number, 'name', r.name, 'description', r.description,
    'is_elimination', r.is_elimination, 'state', r.state, 'published', r.published,
    'published_at', genesis.iso(r.published_at),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'round_id', c.round_id, 'name', c.name, 'max_score', c.max_score, 'sort', c.sort) order by c.sort, c.id)
                          from genesis.criteria c where c.round_id = r.id), '[]'::jsonb),
    'max_total', coalesce((select round(sum(c.max_score), 2) from genesis.criteria c where c.round_id = r.id), 0))
  from genesis.rounds r where r.id = p_id
$$;

create or replace function genesis.team_journey(p_team bigint) returns jsonb
language plpgsql stable as $$
declare
  r genesis.rounds;
  out_at int := null;
  result jsonb := '[]'::jsonb;
  v_status text; v_comments text; v_award text;
  crit jsonb; st text; tot numeric; reached boolean;
begin
  for r in select * from genesis.rounds order by number loop
    reached := out_at is null;
    v_status := null; v_comments := null; v_award := null; st := null; tot := null;
    select status, comments, award into v_status, v_comments, v_award
      from genesis.results where team_id = p_team and round_id = r.id;
    if r.published and reached then
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'max_score', c.max_score, 'score', s.score) order by c.sort, c.id), '[]'::jsonb)
        into crit
        from genesis.criteria c
        left join genesis.scores s on s.criterion_id = c.id and s.team_id = p_team
        where c.round_id = r.id;
      tot := genesis.round_total(r.id, p_team);
      st := genesis.effective_status(r.is_elimination, v_status);
    else
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'max_score', c.max_score, 'score', null) order by c.sort, c.id), '[]'::jsonb)
        into crit from genesis.criteria c where c.round_id = r.id;
      v_comments := null; v_award := null;
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'number', r.number, 'name', r.name, 'description', r.description,
      'is_elimination', r.is_elimination, 'state', r.state, 'published', r.published,
      'max_total', coalesce((select round(sum(c.max_score), 2) from genesis.criteria c where c.round_id = r.id), 0),
      'reached', reached, 'criteria', crit, 'total', tot, 'status', st,
      'comments', coalesce(v_comments, ''), 'award', coalesce(v_award, '')));
    if st = 'eliminated' then out_at := r.number; end if;
  end loop;
  return result;
end $$;

create or replace function genesis.standing(j jsonb) returns jsonb
language plpgsql immutable as $$
declare
  e jsonb; last_pub jsonb := null; active jsonb := null; last_r jsonb; nxt jsonb; next_no int;
begin
  if j is null or jsonb_array_length(j) = 0 then
    return jsonb_build_object('kind', 'waiting', 'round', null, 'title', 'You’re in', 'text', 'Your results will appear here after each round. Keep an eye on announcements.');
  end if;
  last_r := j -> (jsonb_array_length(j) - 1);
  for e in select value from jsonb_array_elements(j) loop
    if active is null and e->>'state' in ('live', 'judging') then active := e; end if;
    if not (e->>'published')::boolean or not (e->>'reached')::boolean then continue; end if;
    if e->>'status' = 'eliminated' then
      return jsonb_build_object('kind', 'eliminated', 'round', (e->>'number')::int,
        'title', 'Not selected after Round ' || (e->>'number'),
        'text', 'Thank you for building with us. Your scores and the judges’ notes are in your scorecard.');
    end if;
    last_pub := e;
  end loop;

  if last_pub is null then
    if active is not null then
      return jsonb_build_object('kind', 'waiting', 'round', (active->>'number')::int,
        'title', 'Round ' || (active->>'number') || case when active->>'state' = 'judging' then ' is being judged' else ' is on' end,
        'text', (active->>'name') || '. Results will appear here as soon as the organisers publish them.');
    end if;
    return jsonb_build_object('kind', 'waiting', 'round', (j->0->>'number')::int, 'title', 'You’re in',
      'text', 'Your results will appear here after each round. Keep an eye on announcements.');
  end if;

  if last_pub->>'status' = 'pending' then
    return jsonb_build_object('kind', 'pending', 'round', (last_pub->>'number')::int,
      'title', 'Round ' || (last_pub->>'number') || ' result pending',
      'text', 'The judges haven’t finalised your result for this round yet.');
  end if;

  if last_pub->>'number' = last_r->>'number' then
    return jsonb_build_object('kind', 'finished', 'round', (last_r->>'number')::int,
      'title', coalesce(nullif(last_pub->>'award', ''), 'Selected in the final round'),
      'text', 'You made it through every round. Congratulations to the whole team.',
      'award', coalesce(last_pub->>'award', ''));
  end if;

  select value into nxt from jsonb_array_elements(j)
    where (value->>'number')::int > (last_pub->>'number')::int
    order by (value->>'number')::int limit 1;
  next_no := coalesce((nxt->>'number')::int, (last_pub->>'number')::int + 1);
  return jsonb_build_object('kind', 'advancing', 'round', (last_pub->>'number')::int, 'next', next_no,
    'title', case when (last_pub->>'is_elimination')::boolean then 'Selected for Round ' else 'Through to Round ' end || next_no,
    'text', case when nxt is not null then 'Next up: ' || (nxt->>'name') || '.' else '' end,
    'award', coalesce(last_pub->>'award', ''));
end $$;

create or replace function genesis.is_competing(p_team bigint) returns boolean
language sql stable as $$
  select genesis.eliminated_in(p_team, true) is null
$$;

create or replace function genesis.leaderboard(p_published_only boolean) returns jsonb
language sql stable as $$
  with r as (
    select * from genesis.rounds where not p_published_only or published
  ), t as (
    select id, code, name, track from genesis.teams where active
  ), e as (
    select t.id as team_id,
      (select min(r.number) from genesis.results res join r on r.id = res.round_id
        where res.team_id = t.id and res.status = 'eliminated') as out_in
    from t
  ), per as (
    select t.id as team_id, r.number,
      case when e.out_in is not null and r.number > e.out_in then null else genesis.round_total(r.id, t.id) end as total
    from t cross join r join e on e.team_id = t.id
  ), agg as (
    select team_id,
      jsonb_agg(jsonb_build_object('round', number, 'total', total) order by number) as rounds,
      case when count(total) = 0 then null else round(sum(total), 2) end as total
    from per group by team_id
  ), aw as (
    select res.team_id, jsonb_agg(res.award order by r.number) as awards
    from genesis.results res join r on r.id = res.round_id
    where res.award <> '' group by res.team_id
  ), ranked as (
    select t.id, t.code, t.name, t.track, e.out_in, coalesce(agg.rounds, '[]'::jsonb) as rounds, agg.total,
      coalesce(aw.awards, '[]'::jsonb) as awards,
      rank() over (order by coalesce(e.out_in, 2147483647) desc, coalesce(agg.total, -1) desc) as rnk
    from t join e on e.team_id = t.id
    left join agg on agg.team_id = t.id
    left join aw on aw.team_id = t.id
  )
  select jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('number', r.number, 'name', r.name, 'published', r.published,
                         'max_total', coalesce((select round(sum(c.max_score), 2) from genesis.criteria c where c.round_id = r.id), 0)) order by r.number) from r), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('team_id', id, 'code', code, 'name', name, 'track', track,
                         'rounds', rounds, 'total', total, 'eliminated_in', out_in, 'awards', awards, 'rank', rnk)
                       order by coalesce(out_in, 2147483647) desc, coalesce(total, -1) desc, name) from ranked), '[]'::jsonb))
$$;

create or replace function genesis.round_sheet(p_round bigint) returns jsonb
language plpgsql stable as $$
declare
  r genesis.rounds; prev_id bigint; prev_elim boolean; prev_no int; v_rows jsonb;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then return null; end if;
  select id, is_elimination, number into prev_id, prev_elim, prev_no
    from genesis.rounds where number < r.number order by number desc limit 1;

  select coalesce(jsonb_agg(obj order by code), '[]'::jsonb) into v_rows from (
    select t.code, jsonb_build_object(
      'team_id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'track', t.track,
      'table_no', t.table_no, 'active', t.active,
      'eligible', t.active and x.out_in is null and x.awaiting is null,
      'eliminated_in', x.out_in, 'awaiting_round', x.awaiting,
      'scores', coalesce((select jsonb_object_agg(s.criterion_id::text, s.score) from genesis.scores s
                            join genesis.criteria c on c.id = s.criterion_id
                           where c.round_id = r.id and s.team_id = t.id), '{}'::jsonb),
      'total', genesis.round_total(r.id, t.id),
      'complete', genesis.round_complete(r.id, t.id),
      'status', coalesce(res.status, 'pending'), 'comments', coalesce(res.comments, ''), 'award', coalesce(res.award, ''),
      'updated_by', res.updated_by, 'updated_at', genesis.iso(res.updated_at)) as obj
    from genesis.teams t
    cross join lateral (
      select o.out_in,
        case when o.out_in is null and prev_id is not null and prev_elim
              and coalesce((select status from genesis.results where team_id = t.id and round_id = prev_id), '') <> 'selected'
             then prev_no end as awaiting
      from (select genesis.eliminated_in(t.id, false, r.number) as out_in) o
    ) x
    left join genesis.results res on res.team_id = t.id and res.round_id = r.id
  ) q;
  return jsonb_build_object('round', genesis.round_json(r.id), 'rows', v_rows);
end $$;

create or replace function genesis.sheet_row(p_round bigint, p_team bigint) returns jsonb
language sql stable as $$
  select x from jsonb_array_elements(genesis.round_sheet(p_round)->'rows') x where (x->>'team_id')::bigint = p_team
$$;

-- ---------------------------------------------------------------------------
-- Content helpers
-- ---------------------------------------------------------------------------

create or replace function genesis.announcement_json(a genesis.announcements) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'priority', a.priority, 'pinned', a.pinned,
    'audience', a.audience, 'author', a.author, 'created_at', genesis.iso(a.created_at), 'updated_at', genesis.iso(a.updated_at))
$$;

create or replace function genesis.team_announcements(p_team bigint) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(genesis.announcement_json(a) order by a.pinned desc, a.created_at desc), '[]'::jsonb)
  from genesis.announcements a
  where a.audience = 'all'
     or (a.audience = 'team' and a.team_id = p_team)
     or (a.audience = 'competing' and genesis.is_competing(p_team))
$$;

create or replace function genesis.schedule_json() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'details', details, 'location', location, 'kind', kind,
    'starts_at', genesis.iso(starts_at), 'ends_at', genesis.iso(ends_at)) order by starts_at, id), '[]'::jsonb)
  from genesis.schedule
$$;

create or replace function genesis.markers_json() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', genesis.iso(starts_at)) order by starts_at), '[]'::jsonb)
  from genesis.schedule where kind in ('round', 'deadline')
$$;

create or replace function genesis.ticket_json(p_id bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', t.id, 'team_id', t.team_id, 'category', t.category, 'subject', t.subject, 'status', t.status,
    'team_unread', t.team_unread, 'admin_unread', t.admin_unread,
    'created_at', genesis.iso(t.created_at), 'updated_at', genesis.iso(t.updated_at),
    'team_code', tm.code, 'team_name', tm.name, 'table_no', tm.table_no,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'ticket_id', m.ticket_id, 'author_type', m.author_type,
                  'author_name', m.author_name, 'body', m.body, 'created_at', genesis.iso(m.created_at)) order by m.created_at, m.id)
                  from genesis.ticket_messages m where m.ticket_id = t.id), '[]'::jsonb))
  from genesis.tickets t join genesis.teams tm on tm.id = t.team_id where t.id = p_id
$$;

create or replace function genesis.team_json(t genesis.teams) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'email', t.email,
    'phone', t.phone, 'members', t.members, 'track', t.track, 'table_no', t.table_no, 'notes', t.notes, 'active', t.active,
    'last_login_at', genesis.iso(t.last_login_at), 'created_at', genesis.iso(t.created_at))
$$;

create or replace function genesis.next_codes(p_count int, p_taken text[] default '{}') returns text[]
language plpgsql as $$
declare prefix text; mx int; result text[] := '{}'; c text; taken text[];
begin
  prefix := upper(regexp_replace(coalesce(genesis.settings_json()->>'team_code_prefix', 'GEN'), '[^A-Za-z0-9]', '', 'g'));
  if prefix = '' then prefix := 'GEN'; end if;
  select coalesce(max(substring(code from '^' || prefix || '([0-9]+)$')::int), 0) into mx
    from genesis.teams where code ~ ('^' || prefix || '[0-9]+$');
  taken := coalesce(p_taken, '{}') || coalesce((select array_agg(code) from genesis.teams), '{}');
  while coalesce(array_length(result, 1), 0) < p_count loop
    mx := mx + 1;
    c := prefix || lpad(mx::text, 3, '0');
    if not (c = any(taken)) then
      result := result || c;
      taken := taken || c;
    end if;
  end loop;
  return result;
end $$;

-- =============================================================================
-- Public API (called by the website)
-- =============================================================================

-- ---- auth ----------------------------------------------------------------------------

create or replace function public.api_login(p_role text, p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  acct text; att genesis.login_attempts; uid bigint; hash text; is_active boolean := true; tok text; mins int;
  uname text := btrim(coalesce(p_username, ''));
begin
  if p_role not in ('team', 'admin') then return jsonb_build_object('__error', 'Role must be team or admin.', 'status', 400); end if;
  if uname = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('__error', case when p_role = 'team' then 'Enter your team ID and password.' else 'Enter your username and password.' end, 'status', 400);
  end if;
  acct := p_role || ':' || lower(uname);
  delete from genesis.login_attempts where first_at < now() - interval '10 minutes';
  select * into att from genesis.login_attempts where key = acct;
  if found and att.count >= 8 then
    mins := greatest(1, ceil(extract(epoch from (att.first_at + interval '10 minutes' - now())) / 60)::int);
    return jsonb_build_object('__error', 'Too many failed sign-in attempts. Try again in ' || mins || ' minute' || case when mins = 1 then '' else 's' end || '.', 'status', 429);
  end if;

  if p_role = 'admin' then
    select id, password_hash into uid, hash from genesis.admins where username = lower(uname);
  else
    select id, password_hash, active into uid, hash, is_active from genesis.teams where code = upper(uname);
  end if;

  if uid is null then perform extensions.crypt(p_password, extensions.gen_salt('bf', 6)); end if;
  if uid is null or not genesis.check_password(p_password, hash) then
    insert into genesis.login_attempts (key, count, first_at) values (acct, 1, now())
      on conflict (key) do update set count = genesis.login_attempts.count + 1;
    return jsonb_build_object('__error', case when p_role = 'team'
      then 'That team ID and password don’t match. Check your credential slip or ask the organisers.'
      else 'That username and password don’t match.' end, 'status', 401);
  end if;
  if not is_active then return jsonb_build_object('__error', 'This team account is disabled. Contact the organisers.', 'status', 403); end if;

  delete from genesis.login_attempts where key = acct;
  delete from genesis.sessions where expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into genesis.sessions (token_hash, role, user_id, expires_at) values (genesis.sha(tok), p_role, uid, now() + interval '7 days');
  if p_role = 'team' then update genesis.teams set last_login_at = now() where id = uid; end if;
  return jsonb_build_object('ok', true, 'token', tok, 'role', p_role);
end $$;

create or replace function public.api_logout(p_token text) returns jsonb
language sql security definer set search_path = genesis, extensions, pg_temp as $$
  delete from genesis.sessions where token_hash = genesis.sha(coalesce(p_token, ''));
  select jsonb_build_object('ok', true);
$$;

create or replace function public.api_me(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  return jsonb_build_object('user', genesis.auth(p_token));
end $$;

create or replace function public.api_change_password(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token); cur text; nxt text; h text;
begin
  if u->>'role' = 'team' and genesis.settings_json()->>'allow_password_change' <> '1' then
    perform genesis.fail(403, 'Password changes are turned off. Ask the organisers if you need a new password.');
  end if;
  cur := genesis.txt(p_body, 'current', 'Current password', 200, true, false);
  nxt := genesis.txt(p_body, 'next', 'New password', 200, true, false);
  if length(nxt) < 8 then perform genesis.fail(400, 'New password must be at least 8 characters.'); end if;
  if u->>'role' = 'admin' then
    select password_hash into h from genesis.admins where id = (u->>'id')::bigint;
  else
    select password_hash into h from genesis.teams where id = (u->>'id')::bigint;
  end if;
  if not genesis.check_password(cur, h) then perform genesis.fail(400, 'Current password is incorrect.'); end if;
  if u->>'role' = 'admin' then
    update genesis.admins set password_hash = genesis.hash_password(nxt, 8) where id = (u->>'id')::bigint;
  else
    update genesis.teams set password_hash = genesis.hash_password(nxt) where id = (u->>'id')::bigint;
  end if;
  delete from genesis.sessions where role = u->>'role' and user_id = (u->>'id')::bigint and token_hash <> genesis.sha(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- ---- public ----------------------------------------------------------------------------

create or replace function public.api_public_info() returns jsonb
language sql security definer set search_path = genesis, extensions, pg_temp as $$
  select jsonb_build_object('event_name', s->>'event_name', 'tagline', s->>'tagline', 'venue', s->>'venue',
    'event_start', s->>'event_start', 'event_end', s->>'event_end', 'markers', genesis.markers_json(),
    'serverTime', genesis.iso(now()))
  from (select genesis.settings_json() as s) x
$$;

-- ---- team portal ----------------------------------------------------------------------

create or replace function public.api_team_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); t genesis.teams; s jsonb := genesis.settings_json(); j jsonb; anns jsonb;
begin
  select * into t from genesis.teams where id = (u->>'id')::bigint;
  j := genesis.team_journey(t.id);
  anns := genesis.team_announcements(t.id);
  return jsonb_build_object(
    'team', jsonb_build_object('code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'email', t.email, 'phone', t.phone,
      'members', t.members, 'track', t.track, 'table_no', t.table_no),
    'event', jsonb_build_object('event_name', s->>'event_name', 'tagline', s->>'tagline', 'venue', s->>'venue',
      'event_start', s->>'event_start', 'event_end', s->>'event_end',
      'leaderboard_visible', s->>'leaderboard_visible' = '1', 'helpdesk_open', s->>'helpdesk_open' = '1',
      'allow_password_change', s->>'allow_password_change' = '1', 'helpdesk_contact', s->>'helpdesk_contact'),
    'journey', j,
    'standing', genesis.standing(j),
    'announcements', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(anns) x limit 3) q), '[]'::jsonb),
    'unread', (select count(*) from jsonb_array_elements(anns) x
               where t.announcements_seen_at is null or (x->>'created_at') > genesis.iso(t.announcements_seen_at)),
    'announcements_seen_at', genesis.iso(t.announcements_seen_at),
    'tickets_unread', (select count(*) from genesis.tickets where team_id = t.id and team_unread),
    'upcoming', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(genesis.schedule_json()) x
                   where coalesce(x->>'ends_at', x->>'starts_at') >= genesis.iso(now()) limit 4) q), '[]'::jsonb),
    'markers', genesis.markers_json(),
    'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_team_announcements(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team');
begin
  return jsonb_build_object('announcements', genesis.team_announcements((u->>'id')::bigint),
    'seen_at', (select genesis.iso(announcements_seen_at) from genesis.teams where id = (u->>'id')::bigint));
end $$;

create or replace function public.api_team_announcements_seen(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team');
begin
  update genesis.teams set announcements_seen_at = now() where id = (u->>'id')::bigint;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_team_schedule(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'team');
  return jsonb_build_object('schedule', genesis.schedule_json(), 'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_team_leaderboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team');
begin
  if genesis.settings_json()->>'leaderboard_visible' <> '1' then perform genesis.fail(403, 'The leaderboard is hidden right now.'); end if;
  return genesis.leaderboard(true) || jsonb_build_object('me', (u->>'id')::bigint);
end $$;

create or replace function public.api_team_tickets(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); s jsonb := genesis.settings_json();
begin
  return jsonb_build_object(
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'team_id', t.team_id, 'category', t.category, 'subject', t.subject,
        'status', t.status, 'team_unread', t.team_unread, 'admin_unread', t.admin_unread,
        'created_at', genesis.iso(t.created_at), 'updated_at', genesis.iso(t.updated_at),
        'message_count', (select count(*) from genesis.ticket_messages m where m.ticket_id = t.id)) order by t.updated_at desc)
      from genesis.tickets t where t.team_id = (u->>'id')::bigint), '[]'::jsonb),
    'categories', jsonb_build_array('Technical help', 'Mentor request', 'Wi-Fi / power', 'Food & logistics', 'Evaluation query', 'Other'),
    'open', s->>'helpdesk_open' = '1',
    'contact', s->>'helpdesk_contact');
end $$;

create or replace function public.api_team_ticket_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); cat text; subj text; msg text; tid bigint; v_team bigint := (u->>'id')::bigint;
begin
  if genesis.settings_json()->>'helpdesk_open' <> '1' then perform genesis.fail(403, 'The help desk is closed right now. Find an organiser in person.'); end if;
  cat := genesis.one_of(p_body->>'category', array['Technical help', 'Mentor request', 'Wi-Fi / power', 'Food & logistics', 'Evaluation query', 'Other'], 'Category');
  subj := genesis.txt(p_body, 'subject', 'Subject', 120, true);
  msg := genesis.txt(p_body, 'message', 'Message', 3000, true);
  if (select count(*) from genesis.tickets t where t.team_id = v_team and t.status <> 'resolved') >= 10 then
    perform genesis.fail(429, 'You have 10 open requests. Wait for replies before raising more.');
  end if;
  insert into genesis.tickets (team_id, category, subject) values (v_team, cat, subj) returning id into tid;
  insert into genesis.ticket_messages (ticket_id, author_type, author_name, body)
    values (tid, 'team', coalesce(nullif(u->>'leader', ''), u->>'name'), msg);
  perform genesis.notify('ticket', jsonb_build_object('id', tid, 'kind', 'new'), 'admins');
  return jsonb_build_object('ticket', genesis.ticket_json(tid));
end $$;

create or replace function public.api_team_ticket(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team');
begin
  if not exists (select 1 from genesis.tickets where id = p_id and team_id = (u->>'id')::bigint) then
    perform genesis.fail(404, 'That request doesn’t exist.');
  end if;
  update genesis.tickets set team_unread = false where id = p_id and team_unread;
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

create or replace function public.api_team_ticket_reply(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); msg text;
begin
  if not exists (select 1 from genesis.tickets where id = p_id and team_id = (u->>'id')::bigint) then
    perform genesis.fail(404, 'That request doesn’t exist.');
  end if;
  msg := genesis.txt(p_body, 'message', 'Message', 3000, true);
  insert into genesis.ticket_messages (ticket_id, author_type, author_name, body)
    values (p_id, 'team', coalesce(nullif(u->>'leader', ''), u->>'name'), msg);
  update genesis.tickets set updated_at = now(), admin_unread = true,
    status = case when status = 'resolved' then 'open' else status end where id = p_id;
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'reply'), 'admins');
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

-- ---- admin: meta, dashboard, settings --------------------------------------------------

create or replace function public.api_admin_meta(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('me', u, 'settings', genesis.settings_json(),
    'tickets_unread', (select count(*) from genesis.tickets where admin_unread),
    'markers', genesis.markers_json(), 'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_admin_dashboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare n_teams int; n_active int; n_out int; n_logged int;
begin
  perform genesis.auth(p_token, 'admin');
  select count(*), count(*) filter (where active), count(*) filter (where active and genesis.eliminated_in(id, false) is not null),
         count(*) filter (where active and last_login_at is not null)
    into n_teams, n_active, n_out, n_logged from genesis.teams;
  return jsonb_build_object(
    'stats', jsonb_build_object('teams', n_teams, 'active', n_active, 'competing', n_active - n_out, 'eliminated', n_out,
      'logged_in', n_logged,
      'tickets_open', (select count(*) from genesis.tickets where status <> 'resolved'),
      'tickets_unread', (select count(*) from genesis.tickets where admin_unread),
      'online', (select count(distinct (role, user_id)) from genesis.sessions where last_seen_at > now() - interval '10 minutes')),
    'never_logged_in', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by code)
                                  from genesis.teams where active and last_login_at is null), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'name', name, 'state', state,
                         'published', published, 'is_elimination', is_elimination) order by number) from genesis.rounds), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
        select jsonb_build_object('id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status,
          'updated_at', genesis.iso(t.updated_at), 'admin_unread', t.admin_unread, 'team_name', tm.name, 'team_code', tm.code) as x
        from genesis.tickets t join genesis.teams tm on tm.id = t.team_id
        where t.status <> 'resolved' order by t.updated_at desc limit 5) q), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', id, 'title', title, 'priority', priority, 'created_at', genesis.iso(created_at), 'author', author) as x
        from genesis.announcements order by created_at desc limit 3) q), '[]'::jsonb),
    'settings', genesis.settings_json(),
    'markers', genesis.markers_json(),
    'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_admin_settings(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('settings', genesis.settings_json());
end $$;

create or replace function public.api_admin_settings_save(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare b jsonb := coalesce(p_body, '{}'::jsonb); outv jsonb := '{}'::jsonb; merged jsonb; k text; pfx text; t timestamptz;
begin
  perform genesis.auth(p_token, 'admin');
  if b ? 'event_name' then outv := outv || jsonb_build_object('event_name', genesis.txt(b, 'event_name', 'Event name', 80, true)); end if;
  if b ? 'tagline' then outv := outv || jsonb_build_object('tagline', genesis.txt(b, 'tagline', 'Tagline', 160)); end if;
  if b ? 'venue' then outv := outv || jsonb_build_object('venue', genesis.txt(b, 'venue', 'Venue', 160)); end if;
  if b ? 'helpdesk_contact' then outv := outv || jsonb_build_object('helpdesk_contact', genesis.txt(b, 'helpdesk_contact', 'Help desk contact', 600)); end if;
  foreach k in array array['event_start', 'event_end'] loop
    if b ? k then
      t := genesis.ts(b, k, case when k = 'event_start' then 'Start time' else 'End time' end, true);
      outv := outv || jsonb_build_object(k, coalesce(genesis.iso(t), ''));
    end if;
  end loop;
  foreach k in array array['leaderboard_visible', 'helpdesk_open', 'allow_password_change'] loop
    if b ? k then outv := outv || jsonb_build_object(k, case when genesis.flag(b, k) then '1' else '0' end); end if;
  end loop;
  if b ? 'team_code_prefix' then
    pfx := upper(genesis.txt(b, 'team_code_prefix', 'Team ID prefix', 8));
    if pfx <> '' and pfx !~ '^[A-Z0-9]+$' then perform genesis.fail(400, 'Team ID prefix can only use letters and numbers.'); end if;
    outv := outv || jsonb_build_object('team_code_prefix', coalesce(nullif(pfx, ''), 'GEN'));
  end if;
  merged := genesis.settings_json() || outv;
  if merged->>'event_start' <> '' and merged->>'event_end' <> '' and merged->>'event_end' <= merged->>'event_start' then
    perform genesis.fail(400, 'The end time must be after the start time.');
  end if;
  insert into genesis.settings (key, value) select key, value from jsonb_each_text(outv)
    on conflict (key) do update set value = excluded.value;
  perform genesis.notify('settings');
  return jsonb_build_object('settings', genesis.settings_json());
end $$;

-- ---- admin: organiser accounts ------------------------------------------------------------

create or replace function public.api_admin_admins(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('admins', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username,
      'display_name', display_name, 'created_at', genesis.iso(created_at)) order by id) from genesis.admins), '[]'::jsonb),
    'me', (u->>'id')::bigint);
end $$;

create or replace function public.api_admin_admin_rename(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  update genesis.admins set display_name = genesis.txt(p_body, 'display_name', 'Display name', 60, true) where id = p_id;
  if not found then perform genesis.fail(404, 'That organiser account doesn’t exist.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_admin_password(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); uname text; pw text;
begin
  if p_id = (u->>'id')::bigint then perform genesis.fail(400, 'Use “Change my password” for your own account.'); end if;
  select username into uname from genesis.admins where id = p_id;
  if uname is null then perform genesis.fail(404, 'That organiser account doesn’t exist.'); end if;
  pw := genesis.gen_password() || '-' || left(genesis.gen_password(), 4);
  update genesis.admins set password_hash = genesis.hash_password(pw, 8) where id = p_id;
  perform genesis.kick('admin', p_id);
  return jsonb_build_object('username', uname, 'password', pw);
end $$;

-- ---- admin: teams ---------------------------------------------------------------------------

create or replace function public.api_admin_teams(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object(
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) || jsonb_build_object(
        'eliminated_in', genesis.eliminated_in(t.id, false),
        'open_tickets', (select count(*) from genesis.tickets k where k.team_id = t.id and k.status <> 'resolved')) order by t.code)
      from genesis.teams t), '[]'::jsonb),
    'next_code', (genesis.next_codes(1))[1]);
end $$;

create or replace function genesis.read_team(p_body jsonb) returns genesis.teams
language plpgsql as $$
declare t genesis.teams;
begin
  t.name := genesis.txt(p_body, 'name', 'Team name', 80, true);
  t.leader_name := genesis.txt(p_body, 'leader_name', 'Team leader name', 80);
  t.email := genesis.txt(p_body, 'email', 'Email', 120);
  t.phone := genesis.txt(p_body, 'phone', 'Phone', 30);
  t.members := genesis.members(p_body->'members');
  t.track := genesis.txt(p_body, 'track', 'Track', 120);
  t.table_no := genesis.txt(p_body, 'table_no', 'Table', 20);
  t.notes := genesis.txt(p_body, 'notes', 'Notes', 1000);
  return t;
end $$;

create or replace function public.api_admin_team_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare f genesis.teams; v_code text; pw text; t genesis.teams;
begin
  perform genesis.auth(p_token, 'admin');
  f := genesis.read_team(p_body);
  v_code := upper(genesis.txt(p_body, 'code', 'Team ID', 32));
  if v_code <> '' and v_code !~ '^[A-Z0-9_-]{2,32}$' then perform genesis.fail(400, 'Team ID can only use letters, numbers, - and _ (2–32 characters).'); end if;
  if v_code <> '' and exists (select 1 from genesis.teams x where x.code = v_code) then perform genesis.fail(409, 'Team ID ' || v_code || ' is already taken.'); end if;
  if v_code = '' then v_code := (genesis.next_codes(1))[1]; end if;
  pw := genesis.txt(p_body, 'password', 'Password', 100, false, false);
  if pw <> '' and length(pw) < 6 then perform genesis.fail(400, 'Password must be at least 6 characters.'); end if;
  if pw = '' then pw := genesis.gen_password(); end if;
  insert into genesis.teams (code, name, leader_name, email, phone, members, track, table_no, notes, password_hash)
    values (v_code, f.name, f.leader_name, f.email, f.phone, f.members, f.track, f.table_no, f.notes, genesis.hash_password(pw))
    returning * into t;
  perform genesis.notify('teams', '{}'::jsonb, 'admins');
  return jsonb_build_object('team', genesis.team_json(t), 'password', pw);
end $$;

create or replace function public.api_admin_team_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare f genesis.teams; ex genesis.teams; v_code text; act boolean; t genesis.teams;
begin
  perform genesis.auth(p_token, 'admin');
  select * into ex from genesis.teams where id = p_id;
  if not found then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
  f := genesis.read_team(p_body);
  v_code := upper(genesis.txt(p_body, 'code', 'Team ID', 32, true));
  if v_code !~ '^[A-Z0-9_-]{2,32}$' then perform genesis.fail(400, 'Team ID can only use letters, numbers, - and _ (2–32 characters).'); end if;
  if exists (select 1 from genesis.teams x where x.code = v_code and x.id <> p_id) then perform genesis.fail(409, 'Team ID ' || v_code || ' is already taken.'); end if;
  act := case when p_body ? 'active' then genesis.flag(p_body, 'active') else ex.active end;
  update genesis.teams set code = v_code, name = f.name, leader_name = f.leader_name, email = f.email, phone = f.phone,
    members = f.members, track = f.track, table_no = f.table_no, notes = f.notes, active = act
    where id = p_id returning * into t;
  if not act and ex.active then
    perform genesis.kick('team', p_id);
    perform genesis.notify('signed-out', '{}'::jsonb, 'team:' || p_id);
  end if;
  perform genesis.notify('teams', '{}'::jsonb, 'admins');
  perform genesis.notify('profile', '{}'::jsonb, 'team:' || p_id);
  return jsonb_build_object('team', genesis.team_json(t));
end $$;

create or replace function public.api_admin_team_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  if not exists (select 1 from genesis.teams where id = p_id) then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
  perform genesis.kick('team', p_id);
  delete from genesis.teams where id = p_id;
  perform genesis.notify('signed-out', '{}'::jsonb, 'team:' || p_id);
  perform genesis.notify('teams', '{}'::jsonb, 'admins');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_team_password(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare t genesis.teams; pw text;
begin
  perform genesis.auth(p_token, 'admin');
  select * into t from genesis.teams where id = p_id;
  if not found then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
  pw := genesis.txt(p_body, 'password', 'Password', 100, false, false);
  if pw <> '' and length(pw) < 6 then perform genesis.fail(400, 'Password must be at least 6 characters.'); end if;
  if pw = '' then pw := genesis.gen_password(); end if;
  update genesis.teams set password_hash = genesis.hash_password(pw) where id = p_id;
  perform genesis.kick('team', p_id);
  perform genesis.notify('signed-out', '{}'::jsonb, 'team:' || p_id);
  return jsonb_build_object('credentials', jsonb_build_array(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name,
    'leader_name', t.leader_name, 'table_no', t.table_no, 'password', pw)));
end $$;

create or replace function public.api_admin_teams_passwords(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare ids bigint[]; t genesis.teams; pw text; creds jsonb := '[]'::jsonb;
begin
  perform genesis.auth(p_token, 'admin');
  select array_agg(x::bigint) into ids from jsonb_array_elements_text(case when jsonb_typeof(p_body->'ids') = 'array' then p_body->'ids' else '[]'::jsonb end) x;
  for t in select * from genesis.teams where (ids is null and active) or id = any(ids) order by code loop
    pw := genesis.gen_password();
    update genesis.teams set password_hash = genesis.hash_password(pw) where id = t.id;
    perform genesis.kick('team', t.id);
    perform genesis.notify('signed-out', '{}'::jsonb, 'team:' || t.id);
    creds := creds || jsonb_build_array(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name,
      'leader_name', t.leader_name, 'table_no', t.table_no, 'password', pw));
  end loop;
  if jsonb_array_length(creds) = 0 then perform genesis.fail(400, 'No teams to generate passwords for.'); end if;
  return jsonb_build_object('credentials', creds);
end $$;

-- Rows arrive already parsed from the CSV by the website:
-- [{ line, name, code, password, leader_name, email, phone, members, track, table_no }]
create or replace function public.api_admin_teams_import(p_token text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  r jsonb; errs jsonb := '[]'::jsonb; codes text[] := '{}'; c text; nm text; pw text; line int;
  auto text[]; created jsonb := '[]'::jsonb; nid bigint; n_auto int := 0; i int := 0;
begin
  perform genesis.auth(p_token, 'admin');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then perform genesis.fail(400, 'The CSV needs a header row and at least one team.'); end if;
  if jsonb_array_length(p_rows) > 500 then perform genesis.fail(400, 'Import up to 500 teams at a time.'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    line := coalesce((r->>'line')::int, 0);
    nm := btrim(coalesce(r->>'name', ''));
    c := upper(btrim(coalesce(r->>'code', '')));
    pw := coalesce(r->>'password', '');
    if nm = '' then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Team name is empty.')); end if;
    if length(nm) > 80 then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Team name is longer than 80 characters.')); end if;
    if c <> '' then
      if c !~ '^[A-Z0-9_-]{2,32}$' then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Team ID “' || c || '” can only use letters, numbers, - and _.'));
      elsif c = any(codes) then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Team ID ' || c || ' appears twice in the file.'));
      elsif exists (select 1 from genesis.teams where code = c) then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Team ID ' || c || ' already exists.'));
      end if;
      codes := codes || c;
    else
      n_auto := n_auto + 1;
    end if;
    if pw <> '' and length(pw) < 6 then errs := errs || jsonb_build_array(jsonb_build_object('line', line, 'message', 'Password must be at least 6 characters.')); end if;
  end loop;
  if jsonb_array_length(errs) > 0 then
    return jsonb_build_object('__error', 'Fix ' || jsonb_array_length(errs) || ' problem' || case when jsonb_array_length(errs) = 1 then '' else 's' end
      || ' in the CSV and try again. Nothing was imported.', 'status', 400, 'errors', errs);
  end if;
  auto := genesis.next_codes(n_auto, codes);
  for r in select value from jsonb_array_elements(p_rows) loop
    c := upper(btrim(coalesce(r->>'code', '')));
    if c = '' then i := i + 1; c := auto[i]; end if;
    pw := coalesce(nullif(r->>'password', ''), genesis.gen_password());
    insert into genesis.teams (code, name, leader_name, email, phone, members, track, table_no, password_hash)
      values (c, left(btrim(r->>'name'), 80), left(btrim(coalesce(r->>'leader_name', '')), 80), left(btrim(coalesce(r->>'email', '')), 120),
              left(btrim(coalesce(r->>'phone', '')), 30), genesis.members(r->'members'), left(btrim(coalesce(r->>'track', '')), 120),
              left(btrim(coalesce(r->>'table_no', '')), 20), genesis.hash_password(pw))
      returning id into nid;
    created := created || jsonb_build_array(jsonb_build_object('id', nid, 'code', c, 'name', left(btrim(r->>'name'), 80),
      'leader_name', left(btrim(coalesce(r->>'leader_name', '')), 80), 'table_no', left(btrim(coalesce(r->>'table_no', '')), 20), 'password', pw));
  end loop;
  perform genesis.notify('teams', '{}'::jsonb, 'admins');
  return jsonb_build_object('credentials', created);
end $$;

-- ---- admin: rounds & scoring ---------------------------------------------------------------

create or replace function public.api_admin_rounds(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('rounds', coalesce((
    select jsonb_agg(genesis.round_json(r.id) || (
      select jsonb_build_object(
        'eligible', count(*) filter (where (x->>'eligible')::boolean),
        'scored', count(*) filter (where (x->>'eligible')::boolean and (x->>'complete')::boolean),
        'decided', case when r.is_elimination then count(*) filter (where (x->>'eligible')::boolean and x->>'status' <> 'pending')
                        else count(*) filter (where (x->>'eligible')::boolean) end,
        'selected', count(*) filter (where (x->>'eligible')::boolean and x->>'status' = 'selected'),
        'eliminated', count(*) filter (where (x->>'eligible')::boolean and x->>'status' = 'eliminated'))
      from jsonb_array_elements(genesis.round_sheet(r.id)->'rows') x) order by r.number)
    from genesis.rounds r), '[]'::jsonb));
end $$;

create or replace function public.api_admin_round_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare r genesis.rounds;
begin
  perform genesis.auth(p_token, 'admin');
  select * into r from genesis.rounds where id = p_id;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  update genesis.rounds set
    name = genesis.txt(p_body, 'name', 'Round name', 80, true),
    description = genesis.txt(p_body, 'description', 'Description', 1000),
    is_elimination = case when p_body ? 'is_elimination' then genesis.flag(p_body, 'is_elimination') else r.is_elimination end,
    state = case when p_body ? 'state' then genesis.one_of(p_body->>'state', array['upcoming', 'live', 'judging', 'completed'], 'State') else r.state end
    where id = p_id;
  perform genesis.notify('rounds', jsonb_build_object('round', r.number));
  return jsonb_build_object('round', genesis.round_json(p_id));
end $$;

create or replace function public.api_admin_criterion_create(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare nm text; mx numeric;
begin
  perform genesis.auth(p_token, 'admin');
  if not exists (select 1 from genesis.rounds where id = p_round) then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  nm := genesis.txt(p_body, 'name', 'Criterion name', 80, true);
  mx := genesis.num(p_body, 'max_score', 'Maximum score', 1, 1000);
  if (select count(*) from genesis.criteria where round_id = p_round) >= 12 then perform genesis.fail(400, 'A round can have up to 12 criteria.'); end if;
  insert into genesis.criteria (round_id, name, max_score, sort)
    values (p_round, nm, mx, coalesce((select max(sort) + 1 from genesis.criteria where round_id = p_round), 0));
  perform genesis.notify('rounds');
  return jsonb_build_object('round', genesis.round_json(p_round));
end $$;

create or replace function public.api_admin_criterion_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare c genesis.criteria; nm text; mx numeric; hi numeric;
begin
  perform genesis.auth(p_token, 'admin');
  select * into c from genesis.criteria where id = p_id;
  if not found then perform genesis.fail(404, 'That criterion doesn’t exist.'); end if;
  nm := genesis.txt(p_body, 'name', 'Criterion name', 80, true);
  mx := genesis.num(p_body, 'max_score', 'Maximum score', 1, 1000);
  select max(score) into hi from genesis.scores where criterion_id = p_id;
  if hi is not null and hi > mx then
    perform genesis.fail(400, 'Some teams already scored ' || trim_scale(hi) || ' here. Set the maximum to at least ' || trim_scale(hi) || '.');
  end if;
  update genesis.criteria set name = nm, max_score = mx where id = p_id;
  perform genesis.notify('rounds');
  return jsonb_build_object('round', genesis.round_json(c.round_id));
end $$;

create or replace function public.api_admin_criterion_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare rid bigint;
begin
  perform genesis.auth(p_token, 'admin');
  delete from genesis.criteria where id = p_id returning round_id into rid;
  if rid is null then perform genesis.fail(404, 'That criterion doesn’t exist.'); end if;
  perform genesis.notify('rounds');
  return jsonb_build_object('round', genesis.round_json(rid));
end $$;

create or replace function public.api_admin_sheet(p_token text, p_round bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare s jsonb;
begin
  perform genesis.auth(p_token, 'admin');
  s := genesis.round_sheet(p_round);
  if s is null then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  return s;
end $$;

create or replace function public.api_admin_sheet_row(p_token text, p_round bigint, p_team bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('row', genesis.sheet_row(p_round, p_team));
end $$;

create or replace function public.api_admin_sheet_save(p_token text, p_round bigint, p_team bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; c genesis.criteria; k text; v numeric;
  ex genesis.results; st text; cm text; aw text; scores jsonb;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  if not exists (select 1 from genesis.teams where id = p_team) then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
  scores := case when jsonb_typeof(p_body->'scores') = 'object' then p_body->'scores' else '{}'::jsonb end;
  for k in select jsonb_object_keys(scores) loop
    select * into c from genesis.criteria where id = k::bigint and round_id = p_round;
    if not found then perform genesis.fail(400, 'One of the criteria no longer exists. Reload the page.'); end if;
    v := genesis.num(scores, k, c.name, 0, c.max_score, true);
    if v is null then
      delete from genesis.scores where team_id = p_team and criterion_id = c.id;
    else
      insert into genesis.scores (team_id, criterion_id, score) values (p_team, c.id, v)
        on conflict (team_id, criterion_id) do update set score = excluded.score;
    end if;
  end loop;
  select * into ex from genesis.results where team_id = p_team and round_id = p_round;
  st := case when p_body ? 'status' then genesis.one_of(p_body->>'status', array['pending', 'selected', 'eliminated'], 'Status') else coalesce(ex.status, 'pending') end;
  cm := case when p_body ? 'comments' then genesis.txt(p_body, 'comments', 'Judges’ comments', 4000) else coalesce(ex.comments, '') end;
  aw := case when p_body ? 'award' then genesis.txt(p_body, 'award', 'Award', 80) else coalesce(ex.award, '') end;
  insert into genesis.results (team_id, round_id, status, comments, award, updated_by, updated_at)
    values (p_team, p_round, st, cm, aw, u->>'name', now())
    on conflict (team_id, round_id) do update set status = excluded.status, comments = excluded.comments, award = excluded.award,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform genesis.notify('sheet', jsonb_build_object('round_id', p_round, 'team_id', p_team, 'by', u->>'name'), 'admins');
  if r.published then perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', 'updated'), 'team:' || p_team); end if;
  if p_body ? 'status' and st is distinct from coalesce(ex.status, 'pending') then perform genesis.notify('rounds', '{}'::jsonb, 'admins'); end if;
  return jsonb_build_object('row', genesis.sheet_row(p_round, p_team));
end $$;

create or replace function public.api_admin_auto_select(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; top int; cutoff numeric; n_elig int; sel int := 0;
  x record; st text; sh jsonb;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  if not r.is_elimination then perform genesis.fail(400, 'This round has no eliminations, so everyone moves on.'); end if;
  top := genesis.num(p_body, 'top', 'Number of teams', 1, 10000)::int;
  sh := genesis.round_sheet(p_round);
  select count(*) into n_elig from jsonb_array_elements(sh->'rows') e where (e->>'eligible')::boolean;
  if n_elig = 0 then perform genesis.fail(400, 'No teams are eligible for this round.'); end if;
  for x in
    select (e->>'team_id')::bigint as team_id, (e->>'total')::numeric as total,
           row_number() over (order by coalesce((e->>'total')::numeric, -1) desc) - 1 as idx
    from jsonb_array_elements(sh->'rows') e where (e->>'eligible')::boolean
    order by idx
  loop
    -- Teams tied with the last qualifying score all go through.
    if x.idx = least(top, n_elig) - 1 then cutoff := x.total; end if;
    st := case when x.idx < top or (x.total is not null and x.total = cutoff) then 'selected' else 'eliminated' end;
    if st = 'selected' then sel := sel + 1; end if;
    insert into genesis.results (team_id, round_id, status, updated_by, updated_at) values (x.team_id, p_round, st, u->>'name', now())
      on conflict (team_id, round_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end loop;
  perform genesis.notify('rounds', '{}'::jsonb, 'admins');
  if r.published then perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', 'updated'), 'teams'); end if;
  return jsonb_build_object('selected', sel, 'eliminated', n_elig - sel, 'ties', sel - least(top, n_elig));
end $$;

create or replace function public.api_admin_publish(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; pub boolean := genesis.flag(p_body, 'published'); aid bigint;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  update genesis.rounds set published = pub, published_at = case when pub then now() else null end,
    state = case when pub then 'completed' else state end where id = p_round;
  if pub and genesis.flag(p_body, 'announce') then
    insert into genesis.announcements (title, body, priority, audience, author)
      values ('Round ' || r.number || ' results are out',
        case when r.is_elimination
          then 'Results for Round ' || r.number || ' (' || r.name || ') have been published. Open your scorecard to see whether your team is selected for the next round, along with your scores and the judges’ notes.'
          else 'Scores for Round ' || r.number || ' (' || r.name || ') are published. Open your scorecard for your scores and the judges’ notes.' end,
        'important', 'all', u->>'name')
      returning id into aid;
    perform genesis.notify('announcement', jsonb_build_object('id', aid, 'priority', 'important'), 'all');
  end if;
  perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', case when pub then 'published' else 'unpublished' end), 'all');
  return jsonb_build_object('round', genesis.round_json(p_round));
end $$;

create or replace function public.api_admin_leaderboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return genesis.leaderboard(false);
end $$;

-- ---- admin: announcements --------------------------------------------------------------------

create or replace function genesis.read_announcement(p_body jsonb, out title text, out body text, out priority text,
  out audience text, out team_id bigint, out pinned boolean)
language plpgsql as $$
begin
  audience := genesis.one_of(coalesce(nullif(p_body->>'audience', ''), 'all'), array['all', 'competing', 'team'], 'Audience');
  team_id := null;
  if audience = 'team' then
    begin team_id := (p_body->>'team_id')::bigint; exception when others then team_id := null; end;
    if team_id is null or not exists (select 1 from genesis.teams t where t.id = read_announcement.team_id) then
      perform genesis.fail(400, 'Pick the team this announcement is for.');
    end if;
  end if;
  title := genesis.txt(p_body, 'title', 'Title', 140, true);
  body := genesis.txt(p_body, 'body', 'Message', 5000);
  priority := genesis.one_of(coalesce(nullif(p_body->>'priority', ''), 'normal'), array['normal', 'important', 'urgent'], 'Priority');
  pinned := genesis.flag(p_body, 'pinned');
end $$;

create or replace function genesis.announce_targets(p_audience text, p_team bigint) returns text
language sql stable as $$
  select case p_audience when 'all' then 'teams' when 'team' then 'team:' || p_team else 'competing' end
$$;

create or replace function public.api_admin_announcements(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('announcements', coalesce((select jsonb_agg(genesis.announcement_json(a)
      || jsonb_build_object('team_id', a.team_id, 'team_name', t.name, 'team_code', t.code) order by a.pinned desc, a.created_at desc)
    from genesis.announcements a left join genesis.teams t on t.id = a.team_id), '[]'::jsonb));
end $$;

create or replace function public.api_admin_announcement_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); a record; nid bigint;
begin
  select * into a from genesis.read_announcement(p_body);
  insert into genesis.announcements (title, body, priority, audience, team_id, pinned, author)
    values (a.title, a.body, a.priority, a.audience, a.team_id, a.pinned, u->>'name') returning id into nid;
  perform genesis.notify('announcement', jsonb_build_object('id', nid, 'priority', a.priority), genesis.announce_targets(a.audience, a.team_id));
  perform genesis.notify('announcement', jsonb_build_object('id', nid, 'priority', a.priority), 'admins');
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.api_admin_announcement_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare a record;
begin
  perform genesis.auth(p_token, 'admin');
  if not exists (select 1 from genesis.announcements where id = p_id) then perform genesis.fail(404, 'That announcement doesn’t exist.'); end if;
  select * into a from genesis.read_announcement(p_body);
  update genesis.announcements set title = a.title, body = a.body, priority = a.priority, audience = a.audience,
    team_id = a.team_id, pinned = a.pinned, updated_at = now() where id = p_id;
  perform genesis.notify('announcements');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_announcement_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  delete from genesis.announcements where id = p_id;
  perform genesis.notify('announcements');
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin: help desk -------------------------------------------------------------------------

create or replace function public.api_admin_tickets(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'team_id', t.team_id,
      'category', t.category, 'subject', t.subject, 'status', t.status, 'team_unread', t.team_unread, 'admin_unread', t.admin_unread,
      'created_at', genesis.iso(t.created_at), 'updated_at', genesis.iso(t.updated_at),
      'team_code', tm.code, 'team_name', tm.name, 'table_no', tm.table_no,
      'message_count', (select count(*) from genesis.ticket_messages m where m.ticket_id = t.id))
      order by case t.status when 'open' then 0 when 'in_progress' then 1 else 2 end, t.updated_at desc)
    from genesis.tickets t join genesis.teams tm on tm.id = t.team_id), '[]'::jsonb));
end $$;

create or replace function public.api_admin_ticket(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare was_unread boolean;
begin
  perform genesis.auth(p_token, 'admin');
  select admin_unread into was_unread from genesis.tickets where id = p_id;
  if was_unread is null then perform genesis.fail(404, 'That request doesn’t exist.'); end if;
  if was_unread then
    update genesis.tickets set admin_unread = false where id = p_id;
    perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'read'), 'admins');
  end if;
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

create or replace function public.api_admin_ticket_reply(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.tickets; msg text; st text;
begin
  select * into t from genesis.tickets where id = p_id;
  if not found then perform genesis.fail(404, 'That request doesn’t exist.'); end if;
  msg := genesis.txt(p_body, 'message', 'Reply', 3000, true);
  st := case when coalesce(p_body->>'status', '') <> '' then genesis.one_of(p_body->>'status', array['open', 'in_progress', 'resolved'], 'Status')
             when t.status = 'open' then 'in_progress' else t.status end;
  insert into genesis.ticket_messages (ticket_id, author_type, author_name, body) values (p_id, 'admin', u->>'name', msg);
  update genesis.tickets set status = st, updated_at = now(), team_unread = true, admin_unread = false where id = p_id;
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'reply'), 'team:' || t.team_id);
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'update'), 'admins');
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

create or replace function public.api_admin_ticket_status(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare t genesis.tickets; st text;
begin
  perform genesis.auth(p_token, 'admin');
  select * into t from genesis.tickets where id = p_id;
  if not found then perform genesis.fail(404, 'That request doesn’t exist.'); end if;
  st := genesis.one_of(p_body->>'status', array['open', 'in_progress', 'resolved'], 'Status');
  update genesis.tickets set status = st, updated_at = now(), team_unread = true where id = p_id;
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'status', 'status', st), 'team:' || t.team_id);
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'update'), 'admins');
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

-- ---- admin: schedule --------------------------------------------------------------------------

create or replace function genesis.read_schedule(p_body jsonb, out title text, out details text, out location text,
  out kind text, out starts_at timestamptz, out ends_at timestamptz)
language plpgsql as $$
begin
  starts_at := genesis.ts(p_body, 'starts_at', 'Start time');
  ends_at := genesis.ts(p_body, 'ends_at', 'End time', true);
  if ends_at is not null and ends_at < starts_at then perform genesis.fail(400, 'End time must be after the start time.'); end if;
  title := genesis.txt(p_body, 'title', 'Title', 120, true);
  details := genesis.txt(p_body, 'details', 'Details', 1000);
  location := genesis.txt(p_body, 'location', 'Location', 120);
  kind := genesis.one_of(coalesce(nullif(p_body->>'kind', ''), 'general'), array['general', 'round', 'deadline', 'food', 'talk'], 'Type');
end $$;

create or replace function public.api_admin_schedule(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object('schedule', genesis.schedule_json());
end $$;

create or replace function public.api_admin_schedule_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare s record; nid bigint;
begin
  perform genesis.auth(p_token, 'admin');
  select * into s from genesis.read_schedule(p_body);
  insert into genesis.schedule (title, details, location, kind, starts_at, ends_at)
    values (s.title, s.details, s.location, s.kind, s.starts_at, s.ends_at) returning id into nid;
  perform genesis.notify('schedule');
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.api_admin_schedule_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare s record;
begin
  perform genesis.auth(p_token, 'admin');
  if not exists (select 1 from genesis.schedule where id = p_id) then perform genesis.fail(404, 'That schedule item doesn’t exist.'); end if;
  select * into s from genesis.read_schedule(p_body);
  update genesis.schedule set title = s.title, details = s.details, location = s.location, kind = s.kind,
    starts_at = s.starts_at, ends_at = s.ends_at where id = p_id;
  perform genesis.notify('schedule');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_schedule_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  delete from genesis.schedule where id = p_id;
  perform genesis.notify('schedule');
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin: exports, backup, reset --------------------------------------------------------------

create or replace function public.api_admin_export(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object(
    'leaderboard', genesis.leaderboard(false),
    'rounds', coalesce((select jsonb_agg(genesis.round_json(id) order by number) from genesis.rounds), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) order by t.code) from genesis.teams t), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('team_id', team_id, 'round_id', round_id, 'status', status,
                  'comments', comments, 'award', award)) from genesis.results), '[]'::jsonb));
end $$;

-- Everything except password hashes and sessions, as JSON.
create or replace function public.api_admin_backup(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'admin');
  return jsonb_build_object(
    'exported_at', genesis.iso(now()),
    'settings', genesis.settings_json(),
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) order by t.id) from genesis.teams t), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(genesis.round_json(id) order by number) from genesis.rounds), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(to_jsonb(s)) from genesis.scores s), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(r)) from genesis.results r), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from genesis.announcements a), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(genesis.ticket_json(id) order by id) from genesis.tickets), '[]'::jsonb),
    'schedule', genesis.schedule_json());
end $$;

create or replace function public.api_admin_reset(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare scope text := case when p_body->>'scope' = 'everything' then 'everything' else 'scores' end;
begin
  perform genesis.auth(p_token, 'admin');
  if coalesce(p_body->>'confirm', '') <> 'RESET' then perform genesis.fail(400, 'Type RESET to confirm.'); end if;
  delete from genesis.scores;
  delete from genesis.results;
  update genesis.rounds set published = false, published_at = null, state = 'upcoming';
  if scope = 'everything' then
    delete from genesis.sessions where role = 'team';
    delete from genesis.ticket_messages;
    delete from genesis.tickets;
    delete from genesis.announcements;
    delete from genesis.schedule;
    delete from genesis.teams;
    perform genesis.notify('signed-out', '{}'::jsonb, 'teams');
  end if;
  perform genesis.notify('results', jsonb_build_object('kind', 'reset'), 'all');
  perform genesis.notify('teams', '{}'::jsonb, 'admins');
  return jsonb_build_object('ok', true, 'scope', scope);
end $$;

-- ---------------------------------------------------------------------------
-- Organiser accounts are created from the SQL editor only (never from the site):
--   select genesis.create_admin('admin1', 'Organiser 1', 'a-strong-password');
-- ---------------------------------------------------------------------------
create or replace function genesis.create_admin(p_username text, p_name text, p_password text) returns text
language plpgsql as $$
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  insert into genesis.admins (username, display_name, password_hash)
    values (lower(btrim(p_username)), p_name, genesis.hash_password(p_password, 8))
    on conflict (username) do update set display_name = excluded.display_name, password_hash = excluded.password_hash;
  delete from genesis.sessions s using genesis.admins a where s.role = 'admin' and s.user_id = a.id and a.username = lower(btrim(p_username));
  return 'Organiser ' || lower(btrim(p_username)) || ' is ready.';
end $$;

-- ---------------------------------------------------------------------------
-- Permissions: the website (anon key) may only EXECUTE the public.api_* functions.
-- ---------------------------------------------------------------------------
do $$
declare f record; has_roles boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'anon') into has_roles;
  if has_roles then
    execute 'revoke all on schema genesis from anon, authenticated';
    execute 'revoke all on all tables in schema genesis from anon, authenticated';
    execute 'revoke all on all functions in schema genesis from public, anon, authenticated';
  end if;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'api\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if has_roles then execute format('grant execute on function %s to anon, authenticated', f.sig); end if;
  end loop;
end $$;

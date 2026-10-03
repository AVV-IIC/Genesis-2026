-- =============================================================================
-- Genesis — Supabase backend (Hackathon + Ideathon)
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again: it only adds what is missing, upgrades older
-- versions in place (existing data becomes Hackathon data) and replaces
-- functions. Re-running it is how you apply updates.
--
-- Design:
--   * All tables live in the private schema `genesis`; the public key cannot
--     read or write them.
--   * The website calls ONLY the public.api_* functions. Each checks the
--     caller's session token, role and competition before doing anything.
--   * Live updates use Supabase Realtime broadcasts on the "genesis" channel.
--     Broadcasts carry only "something changed" signals, never private data.
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
  competition   text not null default 'hackathon',
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
  competition           text not null default 'hackathon',
  award                 text not null default '',
  result_note           text not null default '',
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

-- Organiser-entered marks. When present they override the judges' average.
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

create table if not exists genesis.judges (
  id                    bigint generated always as identity primary key,
  username              text not null unique,
  display_name          text not null,
  password_hash         text not null,
  active                boolean not null default true,
  last_login_at         timestamptz,
  announcements_seen_at timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists genesis.judge_assignments (
  judge_id bigint not null references genesis.judges(id) on delete cascade,
  round_id bigint not null references genesis.rounds(id) on delete cascade,
  team_id  bigint not null references genesis.teams(id) on delete cascade,
  primary key (judge_id, round_id, team_id)
);

create table if not exists genesis.judge_scores (
  judge_id     bigint not null references genesis.judges(id) on delete cascade,
  team_id      bigint not null references genesis.teams(id) on delete cascade,
  criterion_id bigint not null references genesis.criteria(id) on delete cascade,
  score        numeric not null,
  primary key (judge_id, team_id, criterion_id)
);

create table if not exists genesis.judge_feedback (
  judge_id     bigint not null references genesis.judges(id) on delete cascade,
  team_id      bigint not null references genesis.teams(id) on delete cascade,
  round_id     bigint not null references genesis.rounds(id) on delete cascade,
  comments     text not null default '',
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (judge_id, team_id, round_id)
);

create table if not exists genesis.submissions (
  team_id    bigint primary key references genesis.teams(id) on delete cascade,
  title      text not null,
  problem    text not null default '',
  solution   text not null default '',
  impact     text not null default '',
  deck_url   text not null default '',
  video_url  text not null default '',
  extra_url  text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists genesis.announcements (
  id          bigint generated always as identity primary key,
  title       text not null,
  body        text not null default '',
  priority    text not null default 'normal' check (priority in ('normal','important','urgent')),
  audience    text not null default 'all',
  competition text not null default 'hackathon',
  team_id     bigint references genesis.teams(id) on delete cascade,
  pinned      boolean not null default false,
  author      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
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
  id          bigint generated always as identity primary key,
  title       text not null,
  details     text not null default '',
  location    text not null default '',
  kind        text not null default 'general' check (kind in ('general','round','deadline','food','talk')),
  competition text not null default 'hackathon',
  starts_at   timestamptz not null,
  ends_at     timestamptz
);

create table if not exists genesis.settings (
  key   text primary key,
  value text not null
);

create table if not exists genesis.sessions (
  token_hash   text primary key,
  role         text not null,
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

-- ---------------------------------------------------------------------------
-- Upgrades from the single-competition version (idempotent)
-- ---------------------------------------------------------------------------
alter table genesis.admins        add column if not exists competition text not null default 'hackathon';
alter table genesis.teams         add column if not exists competition text not null default 'hackathon';
alter table genesis.teams         add column if not exists award text not null default '';
alter table genesis.teams         add column if not exists result_note text not null default '';
alter table genesis.announcements add column if not exists competition text not null default 'hackathon';
alter table genesis.schedule      add column if not exists competition text not null default 'hackathon';

alter table genesis.admins        drop constraint if exists admins_competition_check;
alter table genesis.admins        add constraint admins_competition_check check (competition in ('hackathon','ideathon'));
alter table genesis.teams         drop constraint if exists teams_competition_check;
alter table genesis.teams         add constraint teams_competition_check check (competition in ('hackathon','ideathon'));
alter table genesis.announcements drop constraint if exists announcements_audience_check;
alter table genesis.announcements add constraint announcements_audience_check check (audience in ('all','competing','team','judges','everyone'));
alter table genesis.announcements drop constraint if exists announcements_competition_check;
alter table genesis.announcements add constraint announcements_competition_check check (competition in ('hackathon','ideathon','both'));
alter table genesis.schedule      drop constraint if exists schedule_competition_check;
alter table genesis.schedule      add constraint schedule_competition_check check (competition in ('hackathon','ideathon','both'));
alter table genesis.sessions      drop constraint if exists sessions_role_check;
alter table genesis.sessions      add constraint sessions_role_check check (role in ('admin','team','judge'));

-- Settings became per-competition: "hackathon:event_name", "ideathon:event_name"…
update genesis.settings set key = 'hackathon:' || key where position(':' in key) = 0;

create index if not exists idx_criteria_round on genesis.criteria(round_id);
create index if not exists idx_results_round on genesis.results(round_id);
create index if not exists idx_tickets_team on genesis.tickets(team_id);
create index if not exists idx_msgs_ticket on genesis.ticket_messages(ticket_id);
create index if not exists idx_sessions_user on genesis.sessions(role, user_id);
create index if not exists idx_teams_comp on genesis.teams(competition);
create index if not exists idx_assign_round on genesis.judge_assignments(round_id, team_id);
create index if not exists idx_jscores_team on genesis.judge_scores(team_id, criterion_id);

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

-- Functions whose signature changed in this version.
drop function if exists genesis.create_admin(text, text, text);
drop function if exists genesis.settings_json();
drop function if exists genesis.schedule_json();
drop function if exists genesis.markers_json();
drop function if exists genesis.next_codes(int, text[]);
drop function if exists genesis.read_announcement(jsonb);
drop function if exists genesis.read_schedule(jsonb);
drop function if exists genesis.announce_targets(text, bigint);

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not callable from the website)
-- ---------------------------------------------------------------------------

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

create or replace function genesis.comp_label(p_comp text) returns text
language sql immutable as $$
  select case p_comp when 'ideathon' then 'Ideathon' else 'Hackathon' end
$$;

create or replace function genesis.settings_json(p_comp text) returns jsonb
language sql stable as $$
  select case when p_comp = 'ideathon' then
      jsonb_build_object(
        'event_name', 'Genesis Ideathon', 'tagline', '24 hours to shape an idea worth building.',
        'venue', '', 'event_start', '', 'event_end', '',
        'helpdesk_open', '1', 'allow_password_change', '0', 'helpdesk_contact', '', 'team_code_prefix', 'IDE',
        'submissions_enabled', '1', 'submissions_open', '1', 'submission_deadline', '', 'results_published', '0')
    else
      jsonb_build_object(
        'event_name', 'Genesis Hackathon', 'tagline', '24 hours to build what comes next.',
        'venue', '', 'event_start', '', 'event_end', '',
        'leaderboard_visible', '0', 'helpdesk_open', '1', 'allow_password_change', '0',
        'helpdesk_contact', '', 'team_code_prefix', 'GEN')
    end
    || coalesce((select jsonb_object_agg(substr(key, length(p_comp) + 2), value)
                 from genesis.settings where key like p_comp || ':%'), '{}'::jsonb)
$$;

-- Live update signal. Targets: all | comp:<c> | admins:<c> | teams:<c> |
-- team:<id> | judges | competing. Never put private data in the payload.
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

create or replace function genesis.url(p jsonb, k text, label text) returns text
language plpgsql as $$
declare v text := genesis.txt(p, k, label, 500);
begin
  if v <> '' and v !~* '^https?://[^\s]+$' then
    perform genesis.fail(400, label || ' must be a full link starting with https://');
  end if;
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
    select jsonb_build_object('role', 'admin', 'id', id, 'username', username, 'name', display_name, 'competition', competition) into u
      from genesis.admins where id = s.user_id;
  elsif s.role = 'judge' then
    select jsonb_build_object('role', 'judge', 'id', id, 'username', username, 'name', display_name, 'competition', 'hackathon') into u
      from genesis.judges where id = s.user_id and active;
  else
    select jsonb_build_object('role', 'team', 'id', id, 'username', code, 'name', name, 'leader', leader_name, 'competition', competition) into u
      from genesis.teams where id = s.user_id and active;
  end if;
  if u is null then perform genesis.fail(401, 'Your session has ended. Sign in again.'); end if;
  if p_role is not null and u->>'role' <> p_role then perform genesis.fail(403, 'You don’t have access to this.'); end if;
  if s.last_seen_at < now() - interval '5 minutes' then
    update genesis.sessions set last_seen_at = now() where token_hash = s.token_hash;
  end if;
  return u;
end $$;

create or replace function genesis.require_hackathon(u jsonb) returns void
language plpgsql as $$
begin
  if u->>'competition' <> 'hackathon' then
    perform genesis.fail(403, 'Rounds, scoring and judges are only part of the Hackathon.');
  end if;
end $$;

create or replace function genesis.require_ideathon(u jsonb) returns void
language plpgsql as $$
begin
  if u->>'competition' <> 'ideathon' then
    perform genesis.fail(403, 'This is only part of the Ideathon.');
  end if;
end $$;

create or replace function genesis.kick(p_role text, p_user bigint) returns void
language sql as $$
  delete from genesis.sessions where role = p_role and user_id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Rounds, scores and standings (Hackathon)
-- ---------------------------------------------------------------------------

-- Average of the assigned judges' marks for one team and criterion.
create or replace function genesis.judge_avg(p_team bigint, p_criterion bigint) returns numeric
language sql stable as $$
  select round(avg(js.score), 2)
  from genesis.judge_scores js
  join genesis.criteria c on c.id = js.criterion_id
  join genesis.judge_assignments ja on ja.judge_id = js.judge_id and ja.team_id = js.team_id and ja.round_id = c.round_id
  where js.team_id = p_team and js.criterion_id = p_criterion
$$;

-- The mark that counts: an organiser's mark if entered, otherwise the judges' average.
create or replace function genesis.official_score(p_team bigint, p_criterion bigint) returns numeric
language sql stable as $$
  select coalesce((select score from genesis.scores where team_id = p_team and criterion_id = p_criterion),
                  genesis.judge_avg(p_team, p_criterion))
$$;

create or replace function genesis.round_total(p_round bigint, p_team bigint) returns numeric
language sql stable as $$
  select case when count(o) = 0 then null else round(sum(o), 2) end
  from (select genesis.official_score(p_team, c.id) as o from genesis.criteria c where c.round_id = p_round) x
$$;

create or replace function genesis.round_complete(p_round bigint, p_team bigint) returns boolean
language sql stable as $$
  select count(*) > 0 and count(o) = count(*)
  from (select genesis.official_score(p_team, c.id) as o from genesis.criteria c where c.round_id = p_round) x
$$;

create or replace function genesis.effective_status(p_is_elim boolean, p_status text) returns text
language sql immutable as $$
  select case when p_status = 'eliminated' then 'eliminated'
              when not p_is_elim then 'advanced'
              else coalesce(p_status, 'pending') end
$$;

create or replace function genesis.eliminated_in(p_team bigint, p_published_only boolean, p_before int default null) returns int
language sql stable as $$
  select min(r.number) from genesis.results res
  join genesis.rounds r on r.id = res.round_id
  where res.team_id = p_team and res.status = 'eliminated'
    and (not p_published_only or r.published)
    and (p_before is null or r.number < p_before)
$$;

create or replace function genesis.round_open(r genesis.rounds) returns boolean
language sql immutable as $$
  select r.state in ('live', 'judging') and not r.published
$$;

create or replace function genesis.round_json(p_id bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'number', r.number, 'name', r.name, 'description', r.description,
    'is_elimination', r.is_elimination, 'state', r.state, 'published', r.published,
    'published_at', genesis.iso(r.published_at), 'judging_open', genesis.round_open(r),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'round_id', c.round_id, 'name', c.name, 'max_score', c.max_score, 'sort', c.sort) order by c.sort, c.id)
                          from genesis.criteria c where c.round_id = r.id), '[]'::jsonb),
    'max_total', coalesce((select round(sum(c.max_score), 2) from genesis.criteria c where c.round_id = r.id), 0))
  from genesis.rounds r where r.id = p_id
$$;

-- Judges' comments for a team in a round, anonymised as "Judge 1", "Judge 2"…
create or replace function genesis.team_feedback(p_team bigint, p_round bigint) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', 'Judge ' || rn, 'comments', comments) order by rn), '[]'::jsonb)
  from (
    select jf.comments, row_number() over (order by jf.judge_id) as rn
    from genesis.judge_feedback jf
    join genesis.judge_assignments ja on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
    where jf.team_id = p_team and jf.round_id = p_round and btrim(jf.comments) <> ''
  ) q
$$;

create or replace function genesis.team_journey(p_team bigint) returns jsonb
language plpgsql stable as $$
declare
  r genesis.rounds;
  out_at int := null;
  result jsonb := '[]'::jsonb;
  v_status text; v_comments text; v_award text;
  crit jsonb; st text; tot numeric; reached boolean; fb jsonb;
begin
  for r in select * from genesis.rounds order by number loop
    reached := out_at is null;
    v_status := null; v_comments := null; v_award := null; st := null; tot := null; fb := '[]'::jsonb;
    select status, comments, award into v_status, v_comments, v_award
      from genesis.results where team_id = p_team and round_id = r.id;
    if r.published and reached then
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'max_score', c.max_score,
               'score', genesis.official_score(p_team, c.id)) order by c.sort, c.id), '[]'::jsonb)
        into crit from genesis.criteria c where c.round_id = r.id;
      tot := genesis.round_total(r.id, p_team);
      st := genesis.effective_status(r.is_elimination, v_status);
      fb := genesis.team_feedback(p_team, r.id);
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
      'comments', coalesce(v_comments, ''), 'award', coalesce(v_award, ''), 'feedback', fb));
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
    select id, code, name, track from genesis.teams where active and competition = 'hackathon'
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

-- Which hackathon teams are in a round (not eliminated earlier, and selected in
-- the previous round if that round had eliminations).
create or replace function genesis.round_eligibility(p_round bigint)
returns table (team_id bigint, eligible boolean, out_in int, awaiting int)
language plpgsql stable as $$
declare r genesis.rounds; prev_id bigint; prev_elim boolean; prev_no int;
begin
  select * into r from genesis.rounds where id = p_round;
  select p.id, p.is_elimination, p.number into prev_id, prev_elim, prev_no
    from genesis.rounds p where p.number < r.number order by p.number desc limit 1;
  return query
    select t.id, t.active and x.o is null and x.a is null, x.o, x.a
    from genesis.teams t
    cross join lateral (
      select o.o,
        case when o.o is null and prev_id is not null and prev_elim
              and coalesce((select res.status from genesis.results res where res.team_id = t.id and res.round_id = prev_id), '') <> 'selected'
             then prev_no end as a
      from (select genesis.eliminated_in(t.id, false, r.number) as o) o
    ) x
    where t.competition = 'hackathon';
end $$;

create or replace function genesis.round_sheet(p_round bigint) returns jsonb
language plpgsql stable as $$
declare r genesis.rounds; v_rows jsonb;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then return null; end if;
  select coalesce(jsonb_agg(obj order by code), '[]'::jsonb) into v_rows from (
    select t.code, jsonb_build_object(
      'team_id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'track', t.track,
      'table_no', t.table_no, 'active', t.active,
      'eligible', el.eligible, 'eliminated_in', el.out_in, 'awaiting_round', el.awaiting,
      'scores', coalesce((select jsonb_object_agg(s.criterion_id::text, s.score) from genesis.scores s
                            join genesis.criteria c on c.id = s.criterion_id
                           where c.round_id = r.id and s.team_id = t.id), '{}'::jsonb),
      'judge_avg', coalesce((select jsonb_object_agg(c.id::text, genesis.judge_avg(t.id, c.id)) from genesis.criteria c
                              where c.round_id = r.id and genesis.judge_avg(t.id, c.id) is not null), '{}'::jsonb),
      'judges', jsonb_build_object(
        'assigned', (select count(*) from genesis.judge_assignments ja where ja.round_id = r.id and ja.team_id = t.id),
        'done', (select count(*) from genesis.judge_feedback jf join genesis.judge_assignments ja
                   on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
                  where jf.round_id = r.id and jf.team_id = t.id and jf.submitted_at is not null)),
      'total', genesis.round_total(r.id, t.id),
      'complete', genesis.round_complete(r.id, t.id),
      'status', coalesce(res.status, 'pending'), 'comments', coalesce(res.comments, ''), 'award', coalesce(res.award, ''),
      'updated_by', res.updated_by, 'updated_at', genesis.iso(res.updated_at)) as obj
    from genesis.teams t
    join genesis.round_eligibility(r.id) el on el.team_id = t.id
    left join genesis.results res on res.team_id = t.id and res.round_id = r.id
  ) q;
  return jsonb_build_object('round', genesis.round_json(r.id), 'rows', v_rows);
end $$;

create or replace function genesis.sheet_row(p_round bigint, p_team bigint) returns jsonb
language sql stable as $$
  select x from jsonb_array_elements(genesis.round_sheet(p_round)->'rows') x where (x->>'team_id')::bigint = p_team
$$;

-- What one judge entered for one team in one round.
create or replace function genesis.judge_row(p_judge bigint, p_round bigint, p_team bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'team_id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'track', t.track,
    'table_no', t.table_no, 'members', t.members,
    'scores', coalesce((select jsonb_object_agg(js.criterion_id::text, js.score) from genesis.judge_scores js
                          join genesis.criteria c on c.id = js.criterion_id
                         where js.judge_id = p_judge and js.team_id = t.id and c.round_id = p_round), '{}'::jsonb),
    'total', (select round(sum(js.score), 2) from genesis.judge_scores js join genesis.criteria c on c.id = js.criterion_id
               where js.judge_id = p_judge and js.team_id = t.id and c.round_id = p_round),
    'comments', coalesce(jf.comments, ''), 'done', jf.submitted_at is not null,
    'submitted_at', genesis.iso(jf.submitted_at), 'updated_at', genesis.iso(jf.updated_at))
  from genesis.teams t
  left join genesis.judge_feedback jf on jf.judge_id = p_judge and jf.team_id = t.id and jf.round_id = p_round
  where t.id = p_team
$$;

-- ---------------------------------------------------------------------------
-- Content helpers
-- ---------------------------------------------------------------------------

create or replace function genesis.announcement_json(a genesis.announcements) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'priority', a.priority, 'pinned', a.pinned,
    'audience', a.audience, 'competition', a.competition, 'author', a.author,
    'created_at', genesis.iso(a.created_at), 'updated_at', genesis.iso(a.updated_at))
$$;

create or replace function genesis.team_announcements(p_team bigint) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(genesis.announcement_json(a) order by a.pinned desc, a.created_at desc), '[]'::jsonb)
  from genesis.announcements a, genesis.teams t
  where t.id = p_team
    and (a.competition = t.competition or a.competition = 'both')
    and (a.audience in ('all', 'everyone')
         or (a.audience = 'team' and a.team_id = p_team)
         or (a.audience = 'competing' and t.competition = 'hackathon' and genesis.is_competing(p_team)))
$$;

create or replace function genesis.judge_announcements() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(genesis.announcement_json(a) order by a.pinned desc, a.created_at desc), '[]'::jsonb)
  from genesis.announcements a
  where a.competition in ('hackathon', 'both') and a.audience in ('all', 'everyone', 'judges')
$$;

create or replace function genesis.schedule_json(p_comp text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'details', details, 'location', location, 'kind', kind,
    'competition', competition, 'starts_at', genesis.iso(starts_at), 'ends_at', genesis.iso(ends_at)) order by starts_at, id), '[]'::jsonb)
  from genesis.schedule where competition in (p_comp, 'both')
$$;

create or replace function genesis.markers_json(p_comp text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', genesis.iso(starts_at)) order by starts_at), '[]'::jsonb)
  from genesis.schedule where kind in ('round', 'deadline') and competition in (p_comp, 'both')
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
    'competition', t.competition, 'award', t.award, 'result_note', t.result_note,
    'last_login_at', genesis.iso(t.last_login_at), 'created_at', genesis.iso(t.created_at))
$$;

create or replace function genesis.submission_json(s genesis.submissions) returns jsonb
language sql stable as $$
  select case when s.team_id is null then null else jsonb_build_object('team_id', s.team_id, 'title', s.title, 'problem', s.problem,
    'solution', s.solution, 'impact', s.impact, 'deck_url', s.deck_url, 'video_url', s.video_url, 'extra_url', s.extra_url,
    'created_at', genesis.iso(s.created_at), 'updated_at', genesis.iso(s.updated_at)) end
$$;

-- Ideathon: is the team allowed to save its submission right now?
create or replace function genesis.submissions_state() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'enabled', s->>'submissions_enabled' = '1',
    'open', s->>'submissions_enabled' = '1' and s->>'submissions_open' = '1'
            and (coalesce(s->>'submission_deadline', '') = '' or now() < (s->>'submission_deadline')::timestamptz),
    'deadline', s->>'submission_deadline',
    'accepting', s->>'submissions_open' = '1')
  from (select genesis.settings_json('ideathon') as s) x
$$;

create or replace function genesis.next_codes(p_comp text, p_count int, p_taken text[] default '{}') returns text[]
language plpgsql as $$
declare prefix text; mx int; result text[] := '{}'; c text; taken text[];
begin
  prefix := upper(regexp_replace(coalesce(genesis.settings_json(p_comp)->>'team_code_prefix', 'GEN'), '[^A-Za-z0-9]', '', 'g'));
  if prefix = '' then prefix := case when p_comp = 'ideathon' then 'IDE' else 'GEN' end; end if;
  select coalesce(max(substring(code from '^' || prefix || '([0-9]+)$')::int), 0) into mx
    from genesis.teams where code ~ ('^' || prefix || '[0-9]+$');
  taken := coalesce(p_taken, '{}') || coalesce((select array_agg(code) from genesis.teams), '{}');
  while coalesce(array_length(result, 1), 0) < p_count loop
    mx := mx + 1;
    c := prefix || lpad(mx::text, 3, '0');
    if not (c = any(taken)) then result := result || c; taken := taken || c; end if;
  end loop;
  return result;
end $$;

create or replace function genesis.next_judge_username() returns text
language sql stable as $$
  select 'JDG' || lpad((coalesce(max(substring(username from '^JDG([0-9]+)$')::int), 0) + 1)::text, 3, '0')
  from genesis.judges
$$;

-- =============================================================================
-- Public API (called by the website)
-- =============================================================================

-- ---- auth ----------------------------------------------------------------------------

create or replace function public.api_login(p_competition text, p_role text, p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  acct text; att genesis.login_attempts; uid bigint; hash text; is_active boolean := true; comp text; tok text; mins int;
  uname text := btrim(coalesce(p_username, ''));
begin
  if p_competition is null or p_competition not in ('hackathon', 'ideathon') then return jsonb_build_object('__error', 'Choose Hackathon or Ideathon first.', 'status', 400); end if;
  if p_role is null or p_role not in ('team', 'admin', 'judge') then return jsonb_build_object('__error', 'Choose how you are signing in.', 'status', 400); end if;
  if p_role = 'judge' and p_competition <> 'hackathon' then return jsonb_build_object('__error', 'Judges sign in under the Hackathon.', 'status', 400); end if;
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
    select id, password_hash, competition into uid, hash, comp from genesis.admins where username = lower(uname);
  elsif p_role = 'judge' then
    select id, password_hash, active, 'hackathon' into uid, hash, is_active, comp from genesis.judges where upper(username) = upper(uname);
  else
    select id, password_hash, active, competition into uid, hash, is_active, comp from genesis.teams where code = upper(uname);
  end if;

  if uid is null then perform extensions.crypt(p_password, extensions.gen_salt('bf', 6)); end if;
  if uid is null or not genesis.check_password(p_password, hash) then
    insert into genesis.login_attempts (key, count, first_at) values (acct, 1, now())
      on conflict (key) do update set count = genesis.login_attempts.count + 1;
    return jsonb_build_object('__error', case when p_role = 'team'
      then 'That team ID and password don’t match. Check your credential slip or ask the organisers.'
      else 'That username and password don’t match.' end, 'status', 401);
  end if;
  if comp <> p_competition then
    return jsonb_build_object('__error', case when p_role = 'team'
      then upper(uname) || ' is a ' || genesis.comp_label(comp) || ' team. Go back and choose ' || genesis.comp_label(comp) || '.'
      else 'This account belongs to the ' || genesis.comp_label(comp) || '. Go back and choose ' || genesis.comp_label(comp) || '.' end, 'status', 403);
  end if;
  if not is_active then
    return jsonb_build_object('__error', case when p_role = 'judge' then 'This judge account is disabled. Contact the organisers.'
      else 'This team account is disabled. Contact the organisers.' end, 'status', 403);
  end if;

  delete from genesis.login_attempts where key = acct;
  delete from genesis.sessions where expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into genesis.sessions (token_hash, role, user_id, expires_at) values (genesis.sha(tok), p_role, uid, now() + interval '7 days');
  if p_role = 'team' then update genesis.teams set last_login_at = now() where id = uid; end if;
  if p_role = 'judge' then update genesis.judges set last_login_at = now() where id = uid; end if;
  return jsonb_build_object('ok', true, 'token', tok, 'role', p_role, 'competition', comp);
end $$;

-- Sign-in for the previous, Hackathon-only website. It keeps the live site
-- working between running this script and publishing the new website.
create or replace function public.api_login(p_role text, p_username text, p_password text) returns jsonb
language sql security definer set search_path = genesis, extensions, pg_temp as $$
  select public.api_login('hackathon', p_role, p_username, p_password)
$$;

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
declare u jsonb := genesis.auth(p_token); cur text; nxt text; h text; uid bigint := (u->>'id')::bigint;
begin
  if u->>'role' = 'team' and genesis.settings_json(u->>'competition')->>'allow_password_change' <> '1' then
    perform genesis.fail(403, 'Password changes are turned off. Ask the organisers if you need a new password.');
  end if;
  cur := genesis.txt(p_body, 'current', 'Current password', 200, true, false);
  nxt := genesis.txt(p_body, 'next', 'New password', 200, true, false);
  if length(nxt) < 8 then perform genesis.fail(400, 'New password must be at least 8 characters.'); end if;
  if u->>'role' = 'admin' then select password_hash into h from genesis.admins where id = uid;
  elsif u->>'role' = 'judge' then select password_hash into h from genesis.judges where id = uid;
  else select password_hash into h from genesis.teams where id = uid; end if;
  if not genesis.check_password(cur, h) then perform genesis.fail(400, 'Current password is incorrect.'); end if;
  if u->>'role' = 'admin' then update genesis.admins set password_hash = genesis.hash_password(nxt, 8) where id = uid;
  elsif u->>'role' = 'judge' then update genesis.judges set password_hash = genesis.hash_password(nxt) where id = uid;
  else update genesis.teams set password_hash = genesis.hash_password(nxt) where id = uid; end if;
  delete from genesis.sessions where role = u->>'role' and user_id = uid and token_hash <> genesis.sha(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- ---- public ----------------------------------------------------------------------------

create or replace function genesis.public_comp(p_comp text) returns jsonb
language sql stable as $$
  select jsonb_build_object('event_name', s->>'event_name', 'tagline', s->>'tagline', 'venue', s->>'venue',
    'event_start', s->>'event_start', 'event_end', s->>'event_end', 'markers', genesis.markers_json(p_comp))
  from (select genesis.settings_json(p_comp) as s) x
$$;

create or replace function public.api_public_info() returns jsonb
language sql security definer set search_path = genesis, extensions, pg_temp as $$
  select jsonb_build_object(
    'competitions', jsonb_build_object('hackathon', genesis.public_comp('hackathon'), 'ideathon', genesis.public_comp('ideathon')),
    'serverTime', genesis.iso(now()))
$$;

-- ---- team portal ----------------------------------------------------------------------

create or replace function public.api_team_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'team'); t genesis.teams; comp text; s jsonb; j jsonb := '[]'::jsonb; anns jsonb;
  sub genesis.submissions; sstate jsonb;
begin
  select * into t from genesis.teams where id = (u->>'id')::bigint;
  comp := t.competition;
  s := genesis.settings_json(comp);
  if comp = 'hackathon' then j := genesis.team_journey(t.id); end if;
  anns := genesis.team_announcements(t.id);
  select * into sub from genesis.submissions where team_id = t.id;
  sstate := genesis.submissions_state();
  return jsonb_build_object(
    'competition', comp,
    'team', jsonb_build_object('code', t.code, 'name', t.name, 'leader_name', t.leader_name, 'email', t.email, 'phone', t.phone,
      'members', t.members, 'track', t.track, 'table_no', t.table_no),
    'event', jsonb_build_object('event_name', s->>'event_name', 'tagline', s->>'tagline', 'venue', s->>'venue',
      'event_start', s->>'event_start', 'event_end', s->>'event_end',
      'leaderboard_visible', comp = 'hackathon' and s->>'leaderboard_visible' = '1', 'helpdesk_open', s->>'helpdesk_open' = '1',
      'allow_password_change', s->>'allow_password_change' = '1', 'helpdesk_contact', s->>'helpdesk_contact'),
    'journey', j,
    'standing', case when comp = 'hackathon' then genesis.standing(j) else null end,
    'submission', case when comp = 'ideathon' then sstate || jsonb_build_object('mine', genesis.submission_json(sub)) else null end,
    'result', case when comp = 'ideathon' then jsonb_build_object('published', s->>'results_published' = '1',
                 'award', case when s->>'results_published' = '1' then t.award else '' end,
                 'note', case when s->>'results_published' = '1' then t.result_note else '' end) else null end,
    'announcements', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(anns) x limit 3) q), '[]'::jsonb),
    'unread', (select count(*) from jsonb_array_elements(anns) x
               where t.announcements_seen_at is null or (x->>'created_at') > genesis.iso(t.announcements_seen_at)),
    'announcements_seen_at', genesis.iso(t.announcements_seen_at),
    'tickets_unread', (select count(*) from genesis.tickets where team_id = t.id and team_unread),
    'upcoming', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(genesis.schedule_json(comp)) x
                   where coalesce(x->>'ends_at', x->>'starts_at') >= genesis.iso(now()) limit 4) q), '[]'::jsonb),
    'markers', genesis.markers_json(comp),
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
declare u jsonb := genesis.auth(p_token, 'team');
begin
  return jsonb_build_object('schedule', genesis.schedule_json(u->>'competition'), 'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_team_leaderboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team');
begin
  if u->>'competition' <> 'hackathon' or genesis.settings_json('hackathon')->>'leaderboard_visible' <> '1' then
    perform genesis.fail(403, 'The leaderboard is hidden right now.');
  end if;
  return genesis.leaderboard(true) || jsonb_build_object('me', (u->>'id')::bigint);
end $$;

create or replace function public.api_team_submission(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); sub genesis.submissions;
begin
  perform genesis.require_ideathon(u);
  select * into sub from genesis.submissions where team_id = (u->>'id')::bigint;
  return genesis.submissions_state() || jsonb_build_object('submission', genesis.submission_json(sub));
end $$;

create or replace function public.api_team_submission_save(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); st jsonb := genesis.submissions_state(); sub genesis.submissions; tid bigint := (u->>'id')::bigint;
begin
  perform genesis.require_ideathon(u);
  if not (st->>'enabled')::boolean then perform genesis.fail(403, 'Idea submissions are turned off for this Ideathon.'); end if;
  if not (st->>'open')::boolean then perform genesis.fail(403, 'Submissions are closed, so your idea can no longer be changed.'); end if;
  insert into genesis.submissions (team_id, title, problem, solution, impact, deck_url, video_url, extra_url)
    values (tid,
      genesis.txt(p_body, 'title', 'Idea title', 120, true),
      genesis.txt(p_body, 'problem', 'Problem', 2000, true),
      genesis.txt(p_body, 'solution', 'Solution', 3000, true),
      genesis.txt(p_body, 'impact', 'Impact', 1500),
      genesis.url(p_body, 'deck_url', 'Pitch deck link'),
      genesis.url(p_body, 'video_url', 'Video link'),
      genesis.url(p_body, 'extra_url', 'Other link'))
    on conflict (team_id) do update set title = excluded.title, problem = excluded.problem, solution = excluded.solution,
      impact = excluded.impact, deck_url = excluded.deck_url, video_url = excluded.video_url, extra_url = excluded.extra_url,
      updated_at = now()
    returning * into sub;
  perform genesis.notify('submission', jsonb_build_object('team_id', tid), 'admins:ideathon');
  return jsonb_build_object('submission', genesis.submission_json(sub));
end $$;

create or replace function public.api_team_tickets(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'team'); s jsonb := genesis.settings_json(u->>'competition');
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
  if genesis.settings_json(u->>'competition')->>'helpdesk_open' <> '1' then perform genesis.fail(403, 'The help desk is closed right now. Find an organiser in person.'); end if;
  cat := genesis.one_of(p_body->>'category', array['Technical help', 'Mentor request', 'Wi-Fi / power', 'Food & logistics', 'Evaluation query', 'Other'], 'Category');
  subj := genesis.txt(p_body, 'subject', 'Subject', 120, true);
  msg := genesis.txt(p_body, 'message', 'Message', 3000, true);
  if (select count(*) from genesis.tickets t where t.team_id = v_team and t.status <> 'resolved') >= 10 then
    perform genesis.fail(429, 'You have 10 open requests. Wait for replies before raising more.');
  end if;
  insert into genesis.tickets (team_id, category, subject) values (v_team, cat, subj) returning id into tid;
  insert into genesis.ticket_messages (ticket_id, author_type, author_name, body)
    values (tid, 'team', coalesce(nullif(u->>'leader', ''), u->>'name'), msg);
  perform genesis.notify('ticket', jsonb_build_object('id', tid, 'kind', 'new'), 'admins:' || (u->>'competition'));
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
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'reply'), 'admins:' || (u->>'competition'));
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

-- ---- judge portal (Hackathon) -------------------------------------------------------------

create or replace function public.api_judge_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'judge'); jid bigint := (u->>'id')::bigint; s jsonb := genesis.settings_json('hackathon');
  anns jsonb := genesis.judge_announcements(); seen timestamptz;
begin
  select announcements_seen_at into seen from genesis.judges where id = jid;
  return jsonb_build_object(
    'judge', jsonb_build_object('name', u->>'name', 'username', u->>'username'),
    'event', jsonb_build_object('event_name', s->>'event_name', 'tagline', s->>'tagline', 'venue', s->>'venue',
      'event_start', s->>'event_start', 'event_end', s->>'event_end'),
    'rounds', coalesce((select jsonb_agg(genesis.round_json(r.id) || jsonb_build_object(
        'assigned', (select count(*) from genesis.judge_assignments ja join genesis.teams t on t.id = ja.team_id
                      where ja.judge_id = jid and ja.round_id = r.id and t.active),
        'done', (select count(*) from genesis.judge_feedback jf join genesis.judge_assignments ja
                   on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
                  where jf.judge_id = jid and jf.round_id = r.id and jf.submitted_at is not null)) order by r.number)
      from genesis.rounds r), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(anns) x limit 3) q), '[]'::jsonb),
    'unread', (select count(*) from jsonb_array_elements(anns) x where seen is null or (x->>'created_at') > genesis.iso(seen)),
    'announcements_seen_at', genesis.iso(seen),
    'markers', genesis.markers_json('hackathon'),
    'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_judge_round(p_token text, p_round bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'judge'); jid bigint := (u->>'id')::bigint;
begin
  if not exists (select 1 from genesis.rounds where id = p_round) then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  return jsonb_build_object('round', genesis.round_json(p_round),
    'teams', coalesce((select jsonb_agg(genesis.judge_row(jid, p_round, t.id) order by t.code)
      from genesis.judge_assignments ja join genesis.teams t on t.id = ja.team_id
      where ja.judge_id = jid and ja.round_id = p_round and t.active), '[]'::jsonb));
end $$;

create or replace function public.api_judge_save(p_token text, p_round bigint, p_team bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'judge'); jid bigint := (u->>'id')::bigint; r genesis.rounds; c genesis.criteria;
  k text; v numeric; scores jsonb; cm text; ex genesis.judge_feedback;
begin
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  if not exists (select 1 from genesis.judge_assignments where judge_id = jid and round_id = p_round and team_id = p_team) then
    perform genesis.fail(403, 'This team isn’t assigned to you for this round.');
  end if;
  if not genesis.round_open(r) then
    perform genesis.fail(409, case when r.published then 'Round ' || r.number || ' results are published, so marks are locked.'
                                   else 'Judging for Round ' || r.number || ' isn’t open right now.' end);
  end if;
  scores := case when jsonb_typeof(p_body->'scores') = 'object' then p_body->'scores' else '{}'::jsonb end;
  for k in select jsonb_object_keys(scores) loop
    select * into c from genesis.criteria where id = k::bigint and round_id = p_round;
    if not found then perform genesis.fail(400, 'One of the criteria no longer exists. Reload the page.'); end if;
    v := genesis.num(scores, k, c.name, 0, c.max_score, true);
    if v is null then
      delete from genesis.judge_scores where judge_id = jid and team_id = p_team and criterion_id = c.id;
    else
      insert into genesis.judge_scores (judge_id, team_id, criterion_id, score) values (jid, p_team, c.id, v)
        on conflict (judge_id, team_id, criterion_id) do update set score = excluded.score;
    end if;
  end loop;
  select * into ex from genesis.judge_feedback where judge_id = jid and team_id = p_team and round_id = p_round;
  cm := case when p_body ? 'comments' then genesis.txt(p_body, 'comments', 'Comments', 4000) else coalesce(ex.comments, '') end;
  insert into genesis.judge_feedback (judge_id, team_id, round_id, comments, submitted_at, updated_at)
    values (jid, p_team, p_round, cm,
      case when p_body ? 'done' then case when genesis.flag(p_body, 'done') then coalesce(ex.submitted_at, now()) else null end else ex.submitted_at end,
      now())
    on conflict (judge_id, team_id, round_id) do update set comments = excluded.comments, submitted_at = excluded.submitted_at, updated_at = now();
  perform genesis.notify('sheet', jsonb_build_object('round_id', p_round, 'team_id', p_team, 'by', u->>'name', 'judge', true), 'admins:hackathon');
  return jsonb_build_object('row', genesis.judge_row(jid, p_round, p_team));
end $$;

create or replace function public.api_judge_announcements(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'judge');
begin
  return jsonb_build_object('announcements', genesis.judge_announcements(),
    'seen_at', (select genesis.iso(announcements_seen_at) from genesis.judges where id = (u->>'id')::bigint));
end $$;

create or replace function public.api_judge_announcements_seen(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'judge');
begin
  update genesis.judges set announcements_seen_at = now() where id = (u->>'id')::bigint;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_judge_schedule(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
begin
  perform genesis.auth(p_token, 'judge');
  return jsonb_build_object('schedule', genesis.schedule_json('hackathon'), 'serverTime', genesis.iso(now()));
end $$;

-- ---- admin: meta, dashboard, settings --------------------------------------------------

create or replace function public.api_admin_meta(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
begin
  return jsonb_build_object('me', u, 'competition', comp, 'settings', genesis.settings_json(comp),
    'tickets_unread', (select count(*) from genesis.tickets k join genesis.teams t on t.id = k.team_id where k.admin_unread and t.competition = comp),
    'markers', genesis.markers_json(comp), 'serverTime', genesis.iso(now()));
end $$;

create or replace function public.api_admin_dashboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
  n_teams int; n_active int; n_out int; n_logged int; extra jsonb := '{}'::jsonb;
begin
  select count(*), count(*) filter (where active),
         count(*) filter (where active and comp = 'hackathon' and genesis.eliminated_in(id, false) is not null),
         count(*) filter (where active and last_login_at is not null)
    into n_teams, n_active, n_out, n_logged from genesis.teams where competition = comp;
  if comp = 'hackathon' then
    extra := jsonb_build_object('judging', jsonb_build_object(
      'judges', (select count(*) from genesis.judges where active),
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('number', r.number, 'name', r.name, 'open', genesis.round_open(r),
          'assigned', (select count(*) from genesis.judge_assignments ja where ja.round_id = r.id),
          'done', (select count(*) from genesis.judge_feedback jf join genesis.judge_assignments ja
                     on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
                    where jf.round_id = r.id and jf.submitted_at is not null)) order by r.number)
        from genesis.rounds r), '[]'::jsonb)));
  else
    extra := jsonb_build_object('ideathon', jsonb_build_object(
      'submissions', (select count(*) from genesis.submissions s join genesis.teams t on t.id = s.team_id where t.competition = 'ideathon' and t.active),
      'state', genesis.submissions_state(),
      'results_published', genesis.settings_json('ideathon')->>'results_published' = '1'));
  end if;
  return jsonb_build_object(
    'competition', comp,
    'stats', jsonb_build_object('teams', n_teams, 'active', n_active, 'competing', n_active - n_out, 'eliminated', n_out,
      'logged_in', n_logged,
      'tickets_open', (select count(*) from genesis.tickets k join genesis.teams t on t.id = k.team_id where k.status <> 'resolved' and t.competition = comp),
      'tickets_unread', (select count(*) from genesis.tickets k join genesis.teams t on t.id = k.team_id where k.admin_unread and t.competition = comp),
      'online', (select count(distinct (s.role, s.user_id)) from genesis.sessions s
                  left join genesis.teams t on s.role = 'team' and t.id = s.user_id
                  left join genesis.admins a on s.role = 'admin' and a.id = s.user_id
                 where s.last_seen_at > now() - interval '10 minutes'
                   and (t.competition = comp or a.competition = comp or (s.role = 'judge' and comp = 'hackathon')))),
    'never_logged_in', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by code)
                                  from genesis.teams where active and last_login_at is null and competition = comp), '[]'::jsonb),
    'rounds', case when comp = 'hackathon' then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'name', name, 'state', state,
                         'published', published, 'is_elimination', is_elimination) order by number) from genesis.rounds), '[]'::jsonb) else '[]'::jsonb end,
    'tickets', coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
        select jsonb_build_object('id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status,
          'updated_at', genesis.iso(t.updated_at), 'admin_unread', t.admin_unread, 'team_name', tm.name, 'team_code', tm.code) as x
        from genesis.tickets t join genesis.teams tm on tm.id = t.team_id
        where t.status <> 'resolved' and tm.competition = comp order by t.updated_at desc limit 5) q), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', id, 'title', title, 'priority', priority, 'created_at', genesis.iso(created_at), 'author', author) as x
        from genesis.announcements where competition in (comp, 'both') order by created_at desc limit 3) q), '[]'::jsonb),
    'settings', genesis.settings_json(comp),
    'markers', genesis.markers_json(comp),
    'serverTime', genesis.iso(now())) || extra;
end $$;

create or replace function public.api_admin_settings(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('settings', genesis.settings_json(u->>'competition'), 'competition', u->>'competition');
end $$;

create or replace function public.api_admin_settings_save(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
  b jsonb := coalesce(p_body, '{}'::jsonb); outv jsonb := '{}'::jsonb; merged jsonb; k text; pfx text; t timestamptz;
  flags text[];
begin
  if b ? 'event_name' then outv := outv || jsonb_build_object('event_name', genesis.txt(b, 'event_name', 'Event name', 80, true)); end if;
  if b ? 'tagline' then outv := outv || jsonb_build_object('tagline', genesis.txt(b, 'tagline', 'Tagline', 160)); end if;
  if b ? 'venue' then outv := outv || jsonb_build_object('venue', genesis.txt(b, 'venue', 'Venue', 160)); end if;
  if b ? 'helpdesk_contact' then outv := outv || jsonb_build_object('helpdesk_contact', genesis.txt(b, 'helpdesk_contact', 'Help desk contact', 600)); end if;
  foreach k in array array['event_start', 'event_end', 'submission_deadline'] loop
    if b ? k and (k <> 'submission_deadline' or comp = 'ideathon') then
      t := genesis.ts(b, k, case k when 'event_start' then 'Start time' when 'event_end' then 'End time' else 'Submission deadline' end, true);
      outv := outv || jsonb_build_object(k, coalesce(genesis.iso(t), ''));
    end if;
  end loop;
  flags := case when comp = 'hackathon' then array['leaderboard_visible', 'helpdesk_open', 'allow_password_change']
                else array['helpdesk_open', 'allow_password_change', 'submissions_enabled', 'submissions_open'] end;
  foreach k in array flags loop
    if b ? k then outv := outv || jsonb_build_object(k, case when genesis.flag(b, k) then '1' else '0' end); end if;
  end loop;
  if b ? 'team_code_prefix' then
    pfx := upper(genesis.txt(b, 'team_code_prefix', 'Team ID prefix', 8));
    if pfx <> '' and pfx !~ '^[A-Z0-9]+$' then perform genesis.fail(400, 'Team ID prefix can only use letters and numbers.'); end if;
    if pfx <> '' and pfx = upper(genesis.settings_json(case when comp = 'hackathon' then 'ideathon' else 'hackathon' end)->>'team_code_prefix') then
      perform genesis.fail(400, 'The other competition already uses ' || pfx || '. Pick a different prefix so team IDs never clash.');
    end if;
    outv := outv || jsonb_build_object('team_code_prefix', coalesce(nullif(pfx, ''), case when comp = 'ideathon' then 'IDE' else 'GEN' end));
  end if;
  merged := genesis.settings_json(comp) || outv;
  if merged->>'event_start' <> '' and merged->>'event_end' <> '' and merged->>'event_end' <= merged->>'event_start' then
    perform genesis.fail(400, 'The end time must be after the start time.');
  end if;
  insert into genesis.settings (key, value) select comp || ':' || key, value from jsonb_each_text(outv)
    on conflict (key) do update set value = excluded.value;
  perform genesis.notify('settings', '{}'::jsonb, 'comp:' || comp);
  return jsonb_build_object('settings', genesis.settings_json(comp));
end $$;

-- ---- admin: organiser accounts ------------------------------------------------------------

create or replace function public.api_admin_admins(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('admins', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username,
      'display_name', display_name, 'created_at', genesis.iso(created_at)) order by id)
      from genesis.admins where competition = u->>'competition'), '[]'::jsonb),
    'me', (u->>'id')::bigint);
end $$;

create or replace function public.api_admin_admin_rename(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  update genesis.admins set display_name = genesis.txt(p_body, 'display_name', 'Display name', 60, true)
    where id = p_id and competition = u->>'competition';
  if not found then perform genesis.fail(404, 'That organiser account doesn’t exist.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_admin_password(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); uname text; pw text;
begin
  if p_id = (u->>'id')::bigint then perform genesis.fail(400, 'Use “Change my password” for your own account.'); end if;
  select username into uname from genesis.admins where id = p_id and competition = u->>'competition';
  if uname is null then perform genesis.fail(404, 'That organiser account doesn’t exist.'); end if;
  pw := genesis.gen_password() || '-' || left(genesis.gen_password(), 4);
  update genesis.admins set password_hash = genesis.hash_password(pw, 8) where id = p_id;
  perform genesis.kick('admin', p_id);
  return jsonb_build_object('username', uname, 'password', pw);
end $$;

-- ---- admin: teams ---------------------------------------------------------------------------

create or replace function genesis.own_team(u jsonb, p_id bigint) returns genesis.teams
language plpgsql as $$
declare t genesis.teams;
begin
  select * into t from genesis.teams where id = p_id and competition = u->>'competition';
  if not found then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
  return t;
end $$;

create or replace function public.api_admin_teams(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
begin
  return jsonb_build_object(
    'competition', comp,
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) || jsonb_build_object(
        'eliminated_in', case when comp = 'hackathon' then genesis.eliminated_in(t.id, false) end,
        'has_submission', exists (select 1 from genesis.submissions s where s.team_id = t.id),
        'open_tickets', (select count(*) from genesis.tickets k where k.team_id = t.id and k.status <> 'resolved')) order by t.code)
      from genesis.teams t where t.competition = comp), '[]'::jsonb),
    'next_code', (genesis.next_codes(comp, 1))[1]);
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
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition'; f genesis.teams; v_code text; pw text; t genesis.teams;
begin
  f := genesis.read_team(p_body);
  v_code := upper(genesis.txt(p_body, 'code', 'Team ID', 32));
  if v_code <> '' and v_code !~ '^[A-Z0-9_-]{2,32}$' then perform genesis.fail(400, 'Team ID can only use letters, numbers, - and _ (2–32 characters).'); end if;
  if v_code <> '' and exists (select 1 from genesis.teams x where x.code = v_code) then perform genesis.fail(409, 'Team ID ' || v_code || ' is already taken.'); end if;
  if v_code = '' then v_code := (genesis.next_codes(comp, 1))[1]; end if;
  pw := genesis.txt(p_body, 'password', 'Password', 100, false, false);
  if pw <> '' and length(pw) < 6 then perform genesis.fail(400, 'Password must be at least 6 characters.'); end if;
  if pw = '' then pw := genesis.gen_password(); end if;
  insert into genesis.teams (code, name, leader_name, email, phone, members, track, table_no, notes, password_hash, competition)
    values (v_code, f.name, f.leader_name, f.email, f.phone, f.members, f.track, f.table_no, f.notes, genesis.hash_password(pw), comp)
    returning * into t;
  perform genesis.notify('teams', '{}'::jsonb, 'admins:' || comp);
  return jsonb_build_object('team', genesis.team_json(t), 'password', pw);
end $$;

create or replace function public.api_admin_team_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); f genesis.teams; ex genesis.teams; v_code text; act boolean; t genesis.teams;
begin
  ex := genesis.own_team(u, p_id);
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
  perform genesis.notify('teams', '{}'::jsonb, 'admins:' || ex.competition);
  perform genesis.notify('profile', '{}'::jsonb, 'team:' || p_id);
  return jsonb_build_object('team', genesis.team_json(t));
end $$;

create or replace function public.api_admin_team_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.teams;
begin
  t := genesis.own_team(u, p_id);
  perform genesis.kick('team', p_id);
  delete from genesis.teams where id = p_id;
  perform genesis.notify('signed-out', '{}'::jsonb, 'team:' || p_id);
  perform genesis.notify('teams', '{}'::jsonb, 'admins:' || t.competition);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_team_password(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.teams; pw text;
begin
  t := genesis.own_team(u, p_id);
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
declare u jsonb := genesis.auth(p_token, 'admin'); ids bigint[]; t genesis.teams; pw text; creds jsonb := '[]'::jsonb;
begin
  select array_agg(x::bigint) into ids from jsonb_array_elements_text(case when jsonb_typeof(p_body->'ids') = 'array' then p_body->'ids' else '[]'::jsonb end) x;
  for t in select * from genesis.teams where competition = u->>'competition' and ((ids is null and active) or id = any(ids)) order by code loop
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

-- Rows arrive already parsed from the CSV by the website.
create or replace function public.api_admin_teams_import(p_token text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
  r jsonb; errs jsonb := '[]'::jsonb; codes text[] := '{}'; c text; nm text; pw text; line int;
  auto text[]; created jsonb := '[]'::jsonb; nid bigint; n_auto int := 0; i int := 0;
begin
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
  auto := genesis.next_codes(comp, n_auto, codes);
  for r in select value from jsonb_array_elements(p_rows) loop
    c := upper(btrim(coalesce(r->>'code', '')));
    if c = '' then i := i + 1; c := auto[i]; end if;
    pw := coalesce(nullif(r->>'password', ''), genesis.gen_password());
    insert into genesis.teams (code, name, leader_name, email, phone, members, track, table_no, password_hash, competition)
      values (c, left(btrim(r->>'name'), 80), left(btrim(coalesce(r->>'leader_name', '')), 80), left(btrim(coalesce(r->>'email', '')), 120),
              left(btrim(coalesce(r->>'phone', '')), 30), genesis.members(r->'members'), left(btrim(coalesce(r->>'track', '')), 120),
              left(btrim(coalesce(r->>'table_no', '')), 20), genesis.hash_password(pw), comp)
      returning id into nid;
    created := created || jsonb_build_array(jsonb_build_object('id', nid, 'code', c, 'name', left(btrim(r->>'name'), 80),
      'leader_name', left(btrim(coalesce(r->>'leader_name', '')), 80), 'table_no', left(btrim(coalesce(r->>'table_no', '')), 20), 'password', pw));
  end loop;
  perform genesis.notify('teams', '{}'::jsonb, 'admins:' || comp);
  return jsonb_build_object('credentials', created);
end $$;

-- ---- admin: judges (Hackathon) ------------------------------------------------------------

create or replace function genesis.judge_json(j genesis.judges) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', j.id, 'username', j.username, 'display_name', j.display_name, 'active', j.active,
    'last_login_at', genesis.iso(j.last_login_at), 'created_at', genesis.iso(j.created_at))
$$;

create or replace function public.api_admin_judges(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  return jsonb_build_object(
    'judges', coalesce((select jsonb_agg(genesis.judge_json(j) || jsonb_build_object(
        'rounds', coalesce((select jsonb_agg(jsonb_build_object('number', r.number,
            'assigned', (select count(*) from genesis.judge_assignments ja where ja.judge_id = j.id and ja.round_id = r.id),
            'done', (select count(*) from genesis.judge_feedback jf join genesis.judge_assignments ja
                       on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
                      where jf.judge_id = j.id and jf.round_id = r.id and jf.submitted_at is not null)) order by r.number)
          from genesis.rounds r), '[]'::jsonb)) order by j.username)
      from genesis.judges j), '[]'::jsonb),
    'next_username', genesis.next_judge_username());
end $$;

create or replace function public.api_admin_judge_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); nm text; uname text; pw text; j genesis.judges;
begin
  perform genesis.require_hackathon(u);
  nm := genesis.txt(p_body, 'display_name', 'Judge name', 80, true);
  uname := upper(genesis.txt(p_body, 'username', 'Username', 32));
  if uname <> '' and uname !~ '^[A-Z0-9_-]{2,32}$' then perform genesis.fail(400, 'Username can only use letters, numbers, - and _ (2–32 characters).'); end if;
  if uname <> '' and exists (select 1 from genesis.judges x where upper(x.username) = uname) then perform genesis.fail(409, 'Username ' || uname || ' is already taken.'); end if;
  if uname = '' then uname := genesis.next_judge_username(); end if;
  pw := genesis.txt(p_body, 'password', 'Password', 100, false, false);
  if pw <> '' and length(pw) < 6 then perform genesis.fail(400, 'Password must be at least 6 characters.'); end if;
  if pw = '' then pw := genesis.gen_password(); end if;
  insert into genesis.judges (username, display_name, password_hash) values (uname, nm, genesis.hash_password(pw)) returning * into j;
  perform genesis.notify('judges', '{}'::jsonb, 'admins:hackathon');
  return jsonb_build_object('judge', genesis.judge_json(j), 'password', pw);
end $$;

create or replace function public.api_admin_judge_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); ex genesis.judges; uname text; act boolean; j genesis.judges;
begin
  perform genesis.require_hackathon(u);
  select * into ex from genesis.judges where id = p_id;
  if not found then perform genesis.fail(404, 'That judge doesn’t exist.'); end if;
  uname := upper(genesis.txt(p_body, 'username', 'Username', 32, true));
  if uname !~ '^[A-Z0-9_-]{2,32}$' then perform genesis.fail(400, 'Username can only use letters, numbers, - and _ (2–32 characters).'); end if;
  if exists (select 1 from genesis.judges x where upper(x.username) = uname and x.id <> p_id) then perform genesis.fail(409, 'Username ' || uname || ' is already taken.'); end if;
  act := case when p_body ? 'active' then genesis.flag(p_body, 'active') else ex.active end;
  update genesis.judges set username = uname, display_name = genesis.txt(p_body, 'display_name', 'Judge name', 80, true), active = act
    where id = p_id returning * into j;
  if not act and ex.active then perform genesis.kick('judge', p_id); end if;
  perform genesis.notify('judges', '{}'::jsonb, 'admins:hackathon');
  return jsonb_build_object('judge', genesis.judge_json(j));
end $$;

create or replace function public.api_admin_judge_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  if not exists (select 1 from genesis.judges where id = p_id) then perform genesis.fail(404, 'That judge doesn’t exist.'); end if;
  perform genesis.kick('judge', p_id);
  delete from genesis.judges where id = p_id;
  perform genesis.notify('judges', '{}'::jsonb, 'admins:hackathon');
  perform genesis.notify('rounds', '{}'::jsonb, 'admins:hackathon');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_judge_password(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); j genesis.judges; pw text;
begin
  perform genesis.require_hackathon(u);
  select * into j from genesis.judges where id = p_id;
  if not found then perform genesis.fail(404, 'That judge doesn’t exist.'); end if;
  pw := genesis.gen_password();
  update genesis.judges set password_hash = genesis.hash_password(pw) where id = p_id;
  perform genesis.kick('judge', p_id);
  return jsonb_build_object('credentials', jsonb_build_array(jsonb_build_object('id', j.id, 'code', j.username, 'name', j.display_name,
    'password', pw, 'judge', true)));
end $$;

create or replace function public.api_admin_assignments(p_token text, p_round bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  if not exists (select 1 from genesis.rounds where id = p_round) then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  return jsonb_build_object(
    'round', genesis.round_json(p_round),
    'judges', coalesce((select jsonb_agg(genesis.judge_json(j) order by j.username) from genesis.judges j), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'code', t.code, 'name', t.name, 'track', t.track,
        'table_no', t.table_no, 'eligible', el.eligible) order by t.code)
      from genesis.teams t join genesis.round_eligibility(p_round) el on el.team_id = t.id
      where el.eligible or exists (select 1 from genesis.judge_assignments ja where ja.round_id = p_round and ja.team_id = t.id)), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(jsonb_build_array(judge_id, team_id)) from genesis.judge_assignments where round_id = p_round), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(jsonb_build_array(jf.judge_id, jf.team_id)) from genesis.judge_feedback jf
      where jf.round_id = p_round and jf.submitted_at is not null), '[]'::jsonb));
end $$;

create or replace function public.api_admin_assignments_save(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); pr jsonb; n int := 0;
begin
  perform genesis.require_hackathon(u);
  if not exists (select 1 from genesis.rounds where id = p_round) then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  if jsonb_typeof(p_body->'pairs') is distinct from 'array' then perform genesis.fail(400, 'Send the list of judge–team pairs.'); end if;
  delete from genesis.judge_assignments where round_id = p_round;
  for pr in select value from jsonb_array_elements(p_body->'pairs') loop
    if exists (select 1 from genesis.judges where id = (pr->>0)::bigint)
       and exists (select 1 from genesis.teams where id = (pr->>1)::bigint and competition = 'hackathon') then
      insert into genesis.judge_assignments (judge_id, round_id, team_id) values ((pr->>0)::bigint, p_round, (pr->>1)::bigint)
        on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  perform genesis.notify('assignments', jsonb_build_object('round_id', p_round), 'judges');
  perform genesis.notify('rounds', '{}'::jsonb, 'admins:hackathon');
  return jsonb_build_object('ok', true, 'saved', n);
end $$;

-- ---- admin: rounds & scoring (Hackathon) ----------------------------------------------------

create or replace function public.api_admin_rounds(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  return jsonb_build_object('rounds', coalesce((
    select jsonb_agg(genesis.round_json(r.id) || (
      select jsonb_build_object(
        'eligible', count(*) filter (where (x->>'eligible')::boolean),
        'scored', count(*) filter (where (x->>'eligible')::boolean and (x->>'complete')::boolean),
        'decided', case when r.is_elimination then count(*) filter (where (x->>'eligible')::boolean and x->>'status' <> 'pending')
                        else count(*) filter (where (x->>'eligible')::boolean) end,
        'selected', count(*) filter (where (x->>'eligible')::boolean and x->>'status' = 'selected'),
        'eliminated', count(*) filter (where (x->>'eligible')::boolean and x->>'status' = 'eliminated'),
        'judging', jsonb_build_object(
          'assigned', (select count(*) from genesis.judge_assignments ja where ja.round_id = r.id),
          'done', (select count(*) from genesis.judge_feedback jf join genesis.judge_assignments ja
                     on ja.judge_id = jf.judge_id and ja.team_id = jf.team_id and ja.round_id = jf.round_id
                    where jf.round_id = r.id and jf.submitted_at is not null)))
      from jsonb_array_elements(genesis.round_sheet(r.id)->'rows') x) order by r.number)
    from genesis.rounds r), '[]'::jsonb));
end $$;

create or replace function public.api_admin_round_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds;
begin
  perform genesis.require_hackathon(u);
  select * into r from genesis.rounds where id = p_id;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  update genesis.rounds set
    name = genesis.txt(p_body, 'name', 'Round name', 80, true),
    description = genesis.txt(p_body, 'description', 'Description', 1000),
    is_elimination = case when p_body ? 'is_elimination' then genesis.flag(p_body, 'is_elimination') else r.is_elimination end,
    state = case when p_body ? 'state' then genesis.one_of(p_body->>'state', array['upcoming', 'live', 'judging', 'completed'], 'State') else r.state end
    where id = p_id;
  perform genesis.notify('rounds', jsonb_build_object('round', r.number), 'comp:hackathon');
  return jsonb_build_object('round', genesis.round_json(p_id));
end $$;

create or replace function public.api_admin_criterion_create(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); nm text; mx numeric;
begin
  perform genesis.require_hackathon(u);
  if not exists (select 1 from genesis.rounds where id = p_round) then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  nm := genesis.txt(p_body, 'name', 'Criterion name', 80, true);
  mx := genesis.num(p_body, 'max_score', 'Maximum score', 1, 1000);
  if (select count(*) from genesis.criteria where round_id = p_round) >= 12 then perform genesis.fail(400, 'A round can have up to 12 criteria.'); end if;
  insert into genesis.criteria (round_id, name, max_score, sort)
    values (p_round, nm, mx, coalesce((select max(sort) + 1 from genesis.criteria where round_id = p_round), 0));
  perform genesis.notify('rounds', '{}'::jsonb, 'comp:hackathon');
  return jsonb_build_object('round', genesis.round_json(p_round));
end $$;

create or replace function public.api_admin_criterion_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); c genesis.criteria; nm text; mx numeric; hi numeric;
begin
  perform genesis.require_hackathon(u);
  select * into c from genesis.criteria where id = p_id;
  if not found then perform genesis.fail(404, 'That criterion doesn’t exist.'); end if;
  nm := genesis.txt(p_body, 'name', 'Criterion name', 80, true);
  mx := genesis.num(p_body, 'max_score', 'Maximum score', 1, 1000);
  select max(x) into hi from (
    select score as x from genesis.scores where criterion_id = p_id
    union all select score from genesis.judge_scores where criterion_id = p_id) s;
  if hi is not null and hi > mx then
    perform genesis.fail(400, 'Some teams already scored ' || trim_scale(hi) || ' here. Set the maximum to at least ' || trim_scale(hi) || '.');
  end if;
  update genesis.criteria set name = nm, max_score = mx where id = p_id;
  perform genesis.notify('rounds', '{}'::jsonb, 'comp:hackathon');
  return jsonb_build_object('round', genesis.round_json(c.round_id));
end $$;

create or replace function public.api_admin_criterion_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); rid bigint;
begin
  perform genesis.require_hackathon(u);
  delete from genesis.criteria where id = p_id returning round_id into rid;
  if rid is null then perform genesis.fail(404, 'That criterion doesn’t exist.'); end if;
  perform genesis.notify('rounds', '{}'::jsonb, 'comp:hackathon');
  return jsonb_build_object('round', genesis.round_json(rid));
end $$;

create or replace function public.api_admin_sheet(p_token text, p_round bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); s jsonb;
begin
  perform genesis.require_hackathon(u);
  s := genesis.round_sheet(p_round);
  if s is null then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  return s;
end $$;

create or replace function public.api_admin_sheet_row(p_token text, p_round bigint, p_team bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  return jsonb_build_object('row', genesis.sheet_row(p_round, p_team));
end $$;

-- Each assigned judge's marks and comments for one team in one round.
create or replace function public.api_admin_sheet_judges(p_token text, p_round bigint, p_team bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  return jsonb_build_object('round', genesis.round_json(p_round),
    'team', (select jsonb_build_object('id', id, 'code', code, 'name', name) from genesis.teams where id = p_team),
    'judges', coalesce((select jsonb_agg(genesis.judge_row(ja.judge_id, p_round, p_team)
        || jsonb_build_object('judge_id', j.id, 'judge_name', j.display_name, 'judge_username', j.username) order by j.username)
      from genesis.judge_assignments ja join genesis.judges j on j.id = ja.judge_id
      where ja.round_id = p_round and ja.team_id = p_team), '[]'::jsonb));
end $$;

create or replace function public.api_admin_sheet_save(p_token text, p_round bigint, p_team bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; c genesis.criteria; k text; v numeric;
  ex genesis.results; st text; cm text; aw text; scores jsonb;
begin
  perform genesis.require_hackathon(u);
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  if not exists (select 1 from genesis.teams where id = p_team and competition = 'hackathon') then perform genesis.fail(404, 'That team doesn’t exist.'); end if;
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
  perform genesis.notify('sheet', jsonb_build_object('round_id', p_round, 'team_id', p_team, 'by', u->>'name'), 'admins:hackathon');
  if r.published then perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', 'updated'), 'team:' || p_team); end if;
  if p_body ? 'status' and st is distinct from coalesce(ex.status, 'pending') then perform genesis.notify('rounds', '{}'::jsonb, 'admins:hackathon'); end if;
  return jsonb_build_object('row', genesis.sheet_row(p_round, p_team));
end $$;

create or replace function public.api_admin_auto_select(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare
  u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; top int; cutoff numeric; n_elig int; sel int := 0;
  x record; st text; sh jsonb;
begin
  perform genesis.require_hackathon(u);
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
    if x.idx = least(top, n_elig) - 1 then cutoff := x.total; end if;
    st := case when x.idx < top or (x.total is not null and x.total = cutoff) then 'selected' else 'eliminated' end;
    if st = 'selected' then sel := sel + 1; end if;
    insert into genesis.results (team_id, round_id, status, updated_by, updated_at) values (x.team_id, p_round, st, u->>'name', now())
      on conflict (team_id, round_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end loop;
  perform genesis.notify('rounds', '{}'::jsonb, 'admins:hackathon');
  if r.published then perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', 'updated'), 'teams:hackathon'); end if;
  return jsonb_build_object('selected', sel, 'eliminated', n_elig - sel, 'ties', sel - least(top, n_elig));
end $$;

create or replace function public.api_admin_publish(p_token text, p_round bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); r genesis.rounds; pub boolean := genesis.flag(p_body, 'published'); aid bigint;
begin
  perform genesis.require_hackathon(u);
  select * into r from genesis.rounds where id = p_round;
  if not found then perform genesis.fail(404, 'That round doesn’t exist.'); end if;
  update genesis.rounds set published = pub, published_at = case when pub then now() else null end,
    state = case when pub then 'completed' else state end where id = p_round;
  if pub and genesis.flag(p_body, 'announce') then
    insert into genesis.announcements (title, body, priority, audience, competition, author)
      values ('Round ' || r.number || ' results are out',
        case when r.is_elimination
          then 'Results for Round ' || r.number || ' (' || r.name || ') have been published. Open your scorecard to see whether your team is selected for the next round, along with your scores and the judges’ notes.'
          else 'Scores for Round ' || r.number || ' (' || r.name || ') are published. Open your scorecard for your scores and the judges’ notes.' end,
        'important', 'all', 'hackathon', u->>'name')
      returning id into aid;
    perform genesis.notify('announcement', jsonb_build_object('id', aid, 'priority', 'important'), 'comp:hackathon');
  end if;
  perform genesis.notify('results', jsonb_build_object('round', r.number, 'kind', case when pub then 'published' else 'unpublished' end), 'comp:hackathon');
  return jsonb_build_object('round', genesis.round_json(p_round));
end $$;

create or replace function public.api_admin_leaderboard(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_hackathon(u);
  return genesis.leaderboard(false);
end $$;

-- ---- admin: ideathon submissions & results ------------------------------------------------

create or replace function public.api_admin_submissions(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_ideathon(u);
  return genesis.submissions_state() || jsonb_build_object(
    'submissions', coalesce((select jsonb_agg(genesis.submission_json(s) || jsonb_build_object('code', t.code, 'name', t.name,
        'leader_name', t.leader_name, 'track', t.track, 'table_no', t.table_no) order by s.updated_at desc)
      from genesis.submissions s join genesis.teams t on t.id = s.team_id where t.competition = 'ideathon'), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name) order by t.code)
      from genesis.teams t where t.competition = 'ideathon' and t.active
        and not exists (select 1 from genesis.submissions s where s.team_id = t.id)), '[]'::jsonb));
end $$;

create or replace function public.api_admin_results(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  perform genesis.require_ideathon(u);
  return jsonb_build_object(
    'published', genesis.settings_json('ideathon')->>'results_published' = '1',
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'leader_name', t.leader_name,
        'track', t.track, 'active', t.active, 'award', t.award, 'result_note', t.result_note,
        'submission_title', (select title from genesis.submissions s where s.team_id = t.id)) order by (t.award = ''), t.code)
      from genesis.teams t where t.competition = 'ideathon'), '[]'::jsonb));
end $$;

create or replace function public.api_admin_result_save(p_token text, p_team bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.teams;
begin
  perform genesis.require_ideathon(u);
  t := genesis.own_team(u, p_team);
  update genesis.teams set award = genesis.txt(p_body, 'award', 'Award', 80), result_note = genesis.txt(p_body, 'result_note', 'Note', 1000)
    where id = p_team returning * into t;
  if genesis.settings_json('ideathon')->>'results_published' = '1' then
    perform genesis.notify('results', jsonb_build_object('kind', 'updated'), 'team:' || p_team);
  end if;
  return jsonb_build_object('team', jsonb_build_object('id', t.id, 'award', t.award, 'result_note', t.result_note));
end $$;

create or replace function public.api_admin_results_publish(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); pub boolean := genesis.flag(p_body, 'published'); aid bigint; nm text;
begin
  perform genesis.require_ideathon(u);
  insert into genesis.settings (key, value) values ('ideathon:results_published', case when pub then '1' else '0' end)
    on conflict (key) do update set value = excluded.value;
  if pub and genesis.flag(p_body, 'announce') then
    nm := genesis.settings_json('ideathon')->>'event_name';
    insert into genesis.announcements (title, body, priority, audience, competition, author)
      values (nm || ' results are out', 'The results are published. Open your dashboard to see how your team did. Thank you for taking part!',
        'important', 'all', 'ideathon', u->>'name') returning id into aid;
    perform genesis.notify('announcement', jsonb_build_object('id', aid, 'priority', 'important'), 'comp:ideathon');
  end if;
  perform genesis.notify('results', jsonb_build_object('kind', case when pub then 'published' else 'unpublished' end), 'comp:ideathon');
  return jsonb_build_object('published', pub);
end $$;

-- ---- admin: announcements --------------------------------------------------------------------

create or replace function genesis.read_announcement(p_comp text, p_body jsonb, out title text, out body text, out priority text,
  out audience text, out team_id bigint, out pinned boolean, out competition text)
language plpgsql as $$
begin
  audience := genesis.one_of(coalesce(nullif(p_body->>'audience', ''), 'all'),
    case when p_comp = 'hackathon' then array['all', 'competing', 'team', 'judges', 'everyone'] else array['all', 'team', 'everyone'] end, 'Audience');
  team_id := null;
  if audience = 'team' then
    begin team_id := (p_body->>'team_id')::bigint; exception when others then team_id := null; end;
    if team_id is null or not exists (select 1 from genesis.teams t where t.id = read_announcement.team_id and t.competition = p_comp) then
      perform genesis.fail(400, 'Pick the team this announcement is for.');
    end if;
  end if;
  title := genesis.txt(p_body, 'title', 'Title', 140, true);
  body := genesis.txt(p_body, 'body', 'Message', 5000);
  priority := genesis.one_of(coalesce(nullif(p_body->>'priority', ''), 'normal'), array['normal', 'important', 'urgent'], 'Priority');
  pinned := genesis.flag(p_body, 'pinned');
  competition := case when audience = 'everyone' then 'both' else p_comp end;
end $$;

create or replace function genesis.announce_target(p_comp text, p_audience text, p_team bigint) returns text
language sql immutable as $$
  select case p_audience when 'all' then 'comp:' || p_comp when 'team' then 'team:' || p_team
                         when 'judges' then 'judges' when 'everyone' then 'all' else 'competing' end
$$;

create or replace function public.api_admin_announcements(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('announcements', coalesce((select jsonb_agg(genesis.announcement_json(a)
      || jsonb_build_object('team_id', a.team_id, 'team_name', t.name, 'team_code', t.code) order by a.pinned desc, a.created_at desc)
    from genesis.announcements a left join genesis.teams t on t.id = a.team_id
    where a.competition in (u->>'competition', 'both')), '[]'::jsonb));
end $$;

create or replace function public.api_admin_announcement_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition'; a record; nid bigint;
begin
  select * into a from genesis.read_announcement(comp, p_body);
  insert into genesis.announcements (title, body, priority, audience, competition, team_id, pinned, author)
    values (a.title, a.body, a.priority, a.audience, a.competition, a.team_id, a.pinned, u->>'name') returning id into nid;
  perform genesis.notify('announcement', jsonb_build_object('id', nid, 'priority', a.priority), genesis.announce_target(comp, a.audience, a.team_id));
  -- 'all' and 'everyone' already reach this competition's organisers.
  if a.audience not in ('all', 'everyone') then
    perform genesis.notify('announcement', jsonb_build_object('id', nid, 'priority', a.priority), 'admins:' || comp);
  end if;
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.api_admin_announcement_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); a record;
begin
  if not exists (select 1 from genesis.announcements where id = p_id and competition in (u->>'competition', 'both')) then
    perform genesis.fail(404, 'That announcement doesn’t exist.');
  end if;
  select * into a from genesis.read_announcement(u->>'competition', p_body);
  update genesis.announcements set title = a.title, body = a.body, priority = a.priority, audience = a.audience,
    competition = a.competition, team_id = a.team_id, pinned = a.pinned, updated_at = now() where id = p_id;
  perform genesis.notify('announcements', '{}'::jsonb, 'all');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_announcement_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  delete from genesis.announcements where id = p_id and competition in (u->>'competition', 'both');
  perform genesis.notify('announcements', '{}'::jsonb, 'all');
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin: help desk -------------------------------------------------------------------------

create or replace function genesis.own_ticket(u jsonb, p_id bigint) returns genesis.tickets
language plpgsql as $$
declare t genesis.tickets;
begin
  select k.* into t from genesis.tickets k join genesis.teams tm on tm.id = k.team_id
    where k.id = p_id and tm.competition = u->>'competition';
  if not found then perform genesis.fail(404, 'That request doesn’t exist.'); end if;
  return t;
end $$;

create or replace function public.api_admin_tickets(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'team_id', t.team_id,
      'category', t.category, 'subject', t.subject, 'status', t.status, 'team_unread', t.team_unread, 'admin_unread', t.admin_unread,
      'created_at', genesis.iso(t.created_at), 'updated_at', genesis.iso(t.updated_at),
      'team_code', tm.code, 'team_name', tm.name, 'table_no', tm.table_no,
      'message_count', (select count(*) from genesis.ticket_messages m where m.ticket_id = t.id))
      order by case t.status when 'open' then 0 when 'in_progress' then 1 else 2 end, t.updated_at desc)
    from genesis.tickets t join genesis.teams tm on tm.id = t.team_id where tm.competition = u->>'competition'), '[]'::jsonb));
end $$;

create or replace function public.api_admin_ticket(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.tickets;
begin
  t := genesis.own_ticket(u, p_id);
  if t.admin_unread then
    update genesis.tickets set admin_unread = false where id = p_id;
    perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'read'), 'admins:' || (u->>'competition'));
  end if;
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

create or replace function public.api_admin_ticket_reply(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.tickets; msg text; st text;
begin
  t := genesis.own_ticket(u, p_id);
  msg := genesis.txt(p_body, 'message', 'Reply', 3000, true);
  st := case when coalesce(p_body->>'status', '') <> '' then genesis.one_of(p_body->>'status', array['open', 'in_progress', 'resolved'], 'Status')
             when t.status = 'open' then 'in_progress' else t.status end;
  insert into genesis.ticket_messages (ticket_id, author_type, author_name, body) values (p_id, 'admin', u->>'name', msg);
  update genesis.tickets set status = st, updated_at = now(), team_unread = true, admin_unread = false where id = p_id;
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'reply'), 'team:' || t.team_id);
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'update'), 'admins:' || (u->>'competition'));
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

create or replace function public.api_admin_ticket_status(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); t genesis.tickets; st text;
begin
  t := genesis.own_ticket(u, p_id);
  st := genesis.one_of(p_body->>'status', array['open', 'in_progress', 'resolved'], 'Status');
  update genesis.tickets set status = st, updated_at = now(), team_unread = true where id = p_id;
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'status', 'status', st), 'team:' || t.team_id);
  perform genesis.notify('ticket', jsonb_build_object('id', p_id, 'kind', 'update'), 'admins:' || (u->>'competition'));
  return jsonb_build_object('ticket', genesis.ticket_json(p_id));
end $$;

-- ---- admin: schedule --------------------------------------------------------------------------

create or replace function genesis.read_schedule(p_comp text, p_body jsonb, out title text, out details text, out location text,
  out kind text, out starts_at timestamptz, out ends_at timestamptz, out competition text)
language plpgsql as $$
begin
  starts_at := genesis.ts(p_body, 'starts_at', 'Start time');
  ends_at := genesis.ts(p_body, 'ends_at', 'End time', true);
  if ends_at is not null and ends_at < starts_at then perform genesis.fail(400, 'End time must be after the start time.'); end if;
  title := genesis.txt(p_body, 'title', 'Title', 120, true);
  details := genesis.txt(p_body, 'details', 'Details', 1000);
  location := genesis.txt(p_body, 'location', 'Location', 120);
  kind := genesis.one_of(coalesce(nullif(p_body->>'kind', ''), 'general'), array['general', 'round', 'deadline', 'food', 'talk'], 'Type');
  competition := case when p_body->>'scope' = 'both' then 'both' else p_comp end;
end $$;

create or replace function public.api_admin_schedule(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  return jsonb_build_object('schedule', genesis.schedule_json(u->>'competition'));
end $$;

create or replace function public.api_admin_schedule_create(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); s record; nid bigint;
begin
  select * into s from genesis.read_schedule(u->>'competition', p_body);
  insert into genesis.schedule (title, details, location, kind, starts_at, ends_at, competition)
    values (s.title, s.details, s.location, s.kind, s.starts_at, s.ends_at, s.competition) returning id into nid;
  perform genesis.notify('schedule', '{}'::jsonb, 'all');
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.api_admin_schedule_update(p_token text, p_id bigint, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); s record;
begin
  if not exists (select 1 from genesis.schedule where id = p_id and competition in (u->>'competition', 'both')) then
    perform genesis.fail(404, 'That schedule item doesn’t exist.');
  end if;
  select * into s from genesis.read_schedule(u->>'competition', p_body);
  update genesis.schedule set title = s.title, details = s.details, location = s.location, kind = s.kind,
    starts_at = s.starts_at, ends_at = s.ends_at, competition = s.competition where id = p_id;
  perform genesis.notify('schedule', '{}'::jsonb, 'all');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_admin_schedule_delete(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin');
begin
  delete from genesis.schedule where id = p_id and competition in (u->>'competition', 'both');
  perform genesis.notify('schedule', '{}'::jsonb, 'all');
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin: exports, backup, reset --------------------------------------------------------------

create or replace function public.api_admin_export(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
begin
  return jsonb_build_object(
    'competition', comp,
    'leaderboard', case when comp = 'hackathon' then genesis.leaderboard(false) else null end,
    'rounds', case when comp = 'hackathon' then coalesce((select jsonb_agg(genesis.round_json(id) order by number) from genesis.rounds), '[]'::jsonb) else '[]'::jsonb end,
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) order by t.code) from genesis.teams t where t.competition = comp), '[]'::jsonb),
    'results', case when comp = 'hackathon' then coalesce((select jsonb_agg(jsonb_build_object('team_id', team_id, 'round_id', round_id, 'status', status,
                  'comments', comments, 'award', award)) from genesis.results), '[]'::jsonb) else '[]'::jsonb end,
    'submissions', case when comp = 'ideathon' then coalesce((select jsonb_agg(genesis.submission_json(s) order by s.team_id)
                  from genesis.submissions s join genesis.teams t on t.id = s.team_id where t.competition = 'ideathon'), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.api_admin_backup(p_token text) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
begin
  return jsonb_build_object(
    'exported_at', genesis.iso(now()),
    'competition', comp,
    'settings', genesis.settings_json(comp),
    'teams', coalesce((select jsonb_agg(genesis.team_json(t) order by t.id) from genesis.teams t where t.competition = comp), '[]'::jsonb),
    'rounds', case when comp = 'hackathon' then coalesce((select jsonb_agg(genesis.round_json(id) order by number) from genesis.rounds), '[]'::jsonb) end,
    'scores', case when comp = 'hackathon' then coalesce((select jsonb_agg(to_jsonb(s)) from genesis.scores s), '[]'::jsonb) end,
    'results', case when comp = 'hackathon' then coalesce((select jsonb_agg(to_jsonb(r)) from genesis.results r), '[]'::jsonb) end,
    'judges', case when comp = 'hackathon' then coalesce((select jsonb_agg(genesis.judge_json(j) order by j.id) from genesis.judges j), '[]'::jsonb) end,
    'judge_assignments', case when comp = 'hackathon' then coalesce((select jsonb_agg(to_jsonb(a)) from genesis.judge_assignments a), '[]'::jsonb) end,
    'judge_scores', case when comp = 'hackathon' then coalesce((select jsonb_agg(to_jsonb(s)) from genesis.judge_scores s), '[]'::jsonb) end,
    'judge_feedback', case when comp = 'hackathon' then coalesce((select jsonb_agg(to_jsonb(f)) from genesis.judge_feedback f), '[]'::jsonb) end,
    'submissions', case when comp = 'ideathon' then coalesce((select jsonb_agg(to_jsonb(s)) from genesis.submissions s
                     join genesis.teams t on t.id = s.team_id where t.competition = 'ideathon'), '[]'::jsonb) end,
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from genesis.announcements a where a.competition in (comp, 'both')), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(genesis.ticket_json(k.id) order by k.id) from genesis.tickets k
                 join genesis.teams t on t.id = k.team_id where t.competition = comp), '[]'::jsonb),
    'schedule', genesis.schedule_json(comp));
end $$;

create or replace function public.api_admin_reset(p_token text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = genesis, extensions, pg_temp as $$
declare u jsonb := genesis.auth(p_token, 'admin'); comp text := u->>'competition';
  scope text := case when p_body->>'scope' = 'everything' then 'everything' else 'scores' end;
begin
  if coalesce(p_body->>'confirm', '') <> 'RESET' then perform genesis.fail(400, 'Type RESET to confirm.'); end if;
  if comp = 'hackathon' then
    delete from genesis.scores;
    delete from genesis.results;
    delete from genesis.judge_scores;
    delete from genesis.judge_feedback;
    update genesis.rounds set published = false, published_at = null, state = 'upcoming';
  else
    update genesis.teams set award = '', result_note = '' where competition = 'ideathon';
    delete from genesis.submissions s using genesis.teams t where t.id = s.team_id and t.competition = 'ideathon';
    insert into genesis.settings (key, value) values ('ideathon:results_published', '0') on conflict (key) do update set value = '0';
  end if;
  if scope = 'everything' then
    delete from genesis.sessions s using genesis.teams t where s.role = 'team' and s.user_id = t.id and t.competition = comp;
    delete from genesis.tickets k using genesis.teams t where t.id = k.team_id and t.competition = comp;
    delete from genesis.announcements where competition = comp;
    delete from genesis.schedule where competition = comp;
    delete from genesis.teams where competition = comp;
    if comp = 'hackathon' then
      delete from genesis.sessions where role = 'judge';
      delete from genesis.judges;
    end if;
    perform genesis.notify('signed-out', '{}'::jsonb, 'teams:' || comp);
  end if;
  perform genesis.notify('results', jsonb_build_object('kind', 'reset'), 'comp:' || comp);
  perform genesis.notify('teams', '{}'::jsonb, 'admins:' || comp);
  return jsonb_build_object('ok', true, 'scope', scope);
end $$;

-- ---------------------------------------------------------------------------
-- Organiser accounts are created from the SQL editor only (never from the site):
--   select genesis.create_admin('admin1', 'Organiser 1', 'a-strong-password');                 -- Hackathon
--   select genesis.create_admin('ideaadmin1', 'Organiser 1', 'a-strong-password', 'ideathon'); -- Ideathon
-- ---------------------------------------------------------------------------
create or replace function genesis.create_admin(p_username text, p_name text, p_password text, p_competition text default 'hackathon') returns text
language plpgsql as $$
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  if p_competition not in ('hackathon', 'ideathon') then raise exception 'Competition must be hackathon or ideathon.'; end if;
  insert into genesis.admins (username, display_name, password_hash, competition)
    values (lower(btrim(p_username)), p_name, genesis.hash_password(p_password, 8), p_competition)
    on conflict (username) do update set display_name = excluded.display_name, password_hash = excluded.password_hash,
      competition = excluded.competition;
  delete from genesis.sessions s using genesis.admins a where s.role = 'admin' and s.user_id = a.id and a.username = lower(btrim(p_username));
  return genesis.comp_label(p_competition) || ' organiser ' || lower(btrim(p_username)) || ' is ready.';
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

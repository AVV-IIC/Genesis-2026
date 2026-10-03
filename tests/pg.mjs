// Test helpers: run supabase/schema.sql on PGlite (real Postgres compiled to
// WASM) and call the api_* functions the way PostgREST does.
//
//   node tests/pg.mjs serve [port]   -> local stand-in for Supabase (for the site e2e test)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
export const SCHEMA_V1 = fs.readFileSync(path.join(ROOT, 'tests', 'schema-v1.sql'), 'utf8');

export async function freshDb() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  // Stub of Supabase Realtime's broadcast function that records messages.
  await db.exec(`
    create schema if not exists realtime;
    create table realtime.sent (id serial, payload jsonb, event text, topic text, private boolean);
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
      language sql as $$ insert into realtime.sent (payload, event, topic, private) values (payload, event, topic, private) $$;
  `);
  return db;
}

/** Calls public.<fn>(named args) like PostgREST: PTxxx errors become HTTP xxx. */
export function rpcFor(db) {
  let sigs = null;
  const load = async () => {
    const r = await db.query(`
      select p.proname as name, coalesce(p.proargnames, '{}') as names,
             coalesce((select array_agg(format_type(t, null) order by i) from unnest(p.proargtypes) with ordinality u(t, i)), '{}') as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'api\\_%'`);
    sigs = new Map(r.rows.map((x) => [x.name, x.names.map((nm, i) => ({ name: nm, type: x.types[i] }))]));
  };
  const rpc = async (fn, args = {}) => {
    if (!sigs) await load();
    const params = sigs.get(fn);
    if (!params) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
    const vals = [];
    const parts = params.filter((p) => p.name in args).map((p) => {
      const v = args[p.name];
      vals.push(p.type === 'jsonb' ? JSON.stringify(v ?? null) : v === null || v === undefined ? null : String(v));
      return `${p.name} => $${vals.length}::${p.type}`;
    });
    try {
      const res = await db.query(`select public.${fn}(${parts.join(', ')}) as r`, vals);
      return { status: 200, body: res.rows[0].r };
    } catch (e) {
      const code = e.code || 'P0001';
      const status = /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : 400;
      return { status, body: { code, message: e.message, details: e.detail || null, hint: e.hint || null } };
    }
  };
  rpc.reload = () => { sigs = null; };
  return rpc;
}

export async function serve(port = 54321) {
  const db = await freshDb();
  await db.exec(SCHEMA);
  await db.query(`select genesis.create_admin('admin1', 'Organiser 1', 'local-admin-1')`);
  await db.query(`select genesis.create_admin('ideaadmin1', 'Ideathon Organiser', 'local-idea-1', 'ideathon')`);
  const rpc = rpcFor(db);
  http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.end();
    const m = /^\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(req.url);
    if (!m) { res.statusCode = 404; return res.end('{}'); }
    let body = '';
    for await (const c of req) body += c;
    const out = await rpc(m[1], body ? JSON.parse(body) : {});
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out.body));
  }).listen(port, () => console.log(`local Supabase stand-in on http://localhost:${port}`));
}

if (process.argv[2] === 'serve') serve(Number(process.argv[3]) || 54321);

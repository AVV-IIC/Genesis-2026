# Genesis Ideathon Teams

Official, searchable directory of the 232 registered teams for Genesis Ideathon 2026, run by the Institution's Innovation Council (IIC), Amrita Vishwa Vidyapeetham, Coimbatore.

- **Live:** https://rohith-kumar-ss.github.io/genesis-ideathon-teams/
- **Data:** table `public.ideathon_teams` in the Genesis Supabase project. The public can read it but not change it (row-level security).

## What participants can do

- Search by roll number, name, team name or Team ID. Search ignores case, spaces and dots, so `cb.en.u4are25011` finds `CB. EN. U4ARE25011`.
- When one team matches, it opens as a large card with a **Copy Team ID** button.
- Switch between **Cards** and **Table**, and sort by Team ID or team name.
- Share a search: the address bar keeps it, for example `?q=GEN26-A0H-I014`.

## Editing teams

Open Supabase → **Table Editor** → `ideathon_teams` and edit any cell. The site shows the change on the next page load, and the "Updated" time on the page follows the most recent edit.

| Column | Meaning |
|---|---|
| `team_id` | Team ID, e.g. `GEN26-A0H-I001` (primary key) |
| `team_name` | Team name |
| `tl_name`, `tl_roll` | Team leader's name and roll number |
| `m1_name` … `m3_roll` | Members 1–3, name and roll number |
| `updated_at` | Set automatically on every edit |

To add a team, insert a row with the next free `team_id`. To remove one, delete its row.

The page tidies names and roll numbers on screen only. All-caps or all-lowercase names show in title case, and roll numbers show upper-case without stray spaces. The stored data stays exactly as entered.

## First-time database setup

Run `supabase_setup.sql` once in the Supabase SQL editor. It creates the table, the public read policy and the `updated_at` trigger, and seeds all 232 teams.

**Careful:** re-running it resets every seeded team to the original registration data and overwrites edits made in the Table Editor. Run it again only to start over.

## Files

- `index.html`: page structure
- `css/style.css`: Genesis theme (logo palette, Big Shoulders Display / Figtree / Martian Mono)
- `js/config.js`: Supabase URL, publishable key and table name
- `js/app.js`: loading, search, cards, table, copy
- `fonts/`, `img/`: self-hosted fonts (with licences) and the Genesis logo

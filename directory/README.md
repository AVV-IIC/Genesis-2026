# Genesis Ideathon Teams

Official, searchable directory of the 232 registered teams for Genesis Ideathon 2026, run by the Institution's Innovation Council (IIC), Amrita Vishwa Vidyapeetham, Coimbatore. Each team is marked **Final** (170 teams in the final list) or **Rejected** (the other 62).

- **Live:** https://avv-iic.github.io/Genesis-2026/directory/ (served from the `directory/` folder of AVV-IIC/Genesis-2026; this repo is its source)
- **Data:** table `public.ideathon_teams` in the Genesis Supabase project. The public can read it but not change it (row-level security).

## What participants can do

- Search by roll number, name, team name or Team ID. Search ignores case, spaces and dots, so `cb.en.u4are25011` finds `CB. EN. U4ARE25011`.
- When one team matches, it opens as a large card that says whether the team is in the final list, with a **Copy Team ID** button.
- Filter **All teams / Final / Rejected**. The counts on the buttons follow the search.
- Switch between **Cards** and **Table**, and sort by Team ID or team name.
- Share a search or filter: the address bar keeps both, for example `?q=GEN26-A0H-I014` or `?status=final`.

## Editing teams

Open Supabase → **Table Editor** → `ideathon_teams` and edit any cell. The site shows the change on the next page load, and the "Updated" time on the page follows the most recent edit.

| Column | Meaning |
|---|---|
| `team_id` | Team ID, e.g. `GEN26-A0H-I001` (primary key) |
| `team_name` | Team name |
| `tl_name`, `tl_roll` | Team leader's name and roll number |
| `m1_name` … `m3_roll` | Members 1–3, name and roll number |
| `status` | `final` or `rejected` (shown as a badge and used by the filter) |
| `updated_at` | Set automatically on every edit |

To add a team, insert a row with the next free `team_id`. To remove one, delete its row. To move a team between the lists, change its `status`.

The page tidies names and roll numbers on screen only. All-caps or all-lowercase names show in title case, and roll numbers show upper-case without stray spaces. The stored data stays exactly as entered.

## Database

- `supabase_update_final_list.sql` applies the final list of 8 Oct 2026 to the existing table. It adds `status`, writes the final teams' members (including swaps), marks the 62 rejected teams, and checks the totals. If the totals are wrong, nothing is saved. It is safe to run twice.
- `supabase_setup.sql` is for a brand-new project only. It creates the table, the public read policy and the `updated_at` trigger, and seeds all 232 teams in their final-list state.

**Careful:** re-running either file overwrites later Table Editor edits to the teams it writes.

The page asks for every column (`select=*`). Without a `status` column it simply shows all teams with no badges or filter.

## Files

- `index.html`: page structure
- `css/style.css`: Genesis theme (logo palette, Big Shoulders Display / Figtree / Martian Mono)
- `js/config.js`: Supabase URL, publishable key and table name
- `js/app.js`: loading, search, Final/Rejected filter, cards, table, copy
- `fonts/`, `img/`: self-hosted fonts (with licences) and the Genesis logo

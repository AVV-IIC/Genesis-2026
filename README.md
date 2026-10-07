# Genesis portal: Hackathon + Ideathon

A web portal for running two 24-hour competitions side by side: a **Hackathon** with 4 evaluation rounds and an **Ideathon** with no rounds.

**Live site:** <https://avv-iic.github.io/Genesis-2026/> (add `#hackathon` or `#ideathon` to skip the competition choice). Every push to `main` rebuilds and republishes it automatically (see *Option E*).

The sign-in page first asks **Hackathon or Ideathon**, then how you're signing in.

| | Hackathon | Ideathon |
|---|---|---|
| **Team leaders** | Live status (selected / not selected / pending), a scorecard with per-criterion scores and judges' comments, announcements, schedule, help desk, optional leaderboard | Their idea (if idea submission is on), final result and award, announcements, schedule, help desk |
| **Judges** | Score and comment on the teams assigned to them, round by round | (no judges) |
| **Organisers** | Teams, judges and assignments, rounds and scores, decisions, publishing, announcements, help desk, schedule, leaderboard | Teams, ideas, results and awards, announcements, help desk, schedule |

Organiser accounts are **separate per competition**: Hackathon organisers only see the Hackathon, Ideathon organisers only see the Ideathon. Announcements and schedule items can be marked **Everyone / Both** to reach both competitions (opening, meals, closing).

Everything updates live. When you publish results or post an announcement, every open screen updates within a second, with no refresh needed.

---

## 1. Run it on your computer

You need **Node.js 22.13 or newer** (`node --version`). Nothing else: the database is built into Node.

```bash
cd D:\Genesis_Hackathon
npm install
npm start
```

Open <http://localhost:3000>.

The **first time** it starts, it creates four organiser accounts and prints their passwords in the terminal: `admin1` and `admin2` (Hackathon), `ideaadmin1` and `ideaadmin2` (Ideathon). Save them. To choose your own passwords instead, copy `.env.example` to `.env` and fill in the `ADMIN…_PASSWORD` / `IDEA_ADMIN…_PASSWORD` values **before** the first start.

### Try it with demo data

```bash
npm run seed-demo
npm start
```

This adds a mid-event demo of both competitions:

- Hackathon: 12 teams (`GEN001` … `GEN012`), Rounds 1 and 2 published, Round 3 live with 3 judges (`JDG001` … `JDG003`) part-way through scoring.
- Ideathon: 6 teams (`IDE001` … `IDE006`), 4 ideas submitted.

Every demo team and judge signs in with password `demo-pass`. Clear it before the real event from each console: **Settings → Danger zone**.

---

## 2. Hackathon (organisers)

1. **Settings**: event name, venue, start and end time (this drives the 24-hour countdown dial), help desk contacts.
2. **Rounds & scores → Round settings & criteria**: rename rounds and edit each round's criteria (for example Innovation /10). Round 1 has *no eliminations*, Rounds 2–4 are *elimination* rounds. You can change both.
3. **Teams → Import CSV**: download the template, fill it in Excel or Google Sheets, upload. Team IDs (`GEN001`, …) and passwords are generated. A window shows every password once, with **Print slips** and **Download CSV**.
4. **Judges → Add judge**: creates a Judge ID (`JDG001`, …) and password with a printable slip. Judges sign in by choosing *Hackathon → Judge*.
5. **Judges → Assignments**: for each round, tick which judge scores which team. Quick actions: *Every judge, every team*, *Split teams evenly* (for example 2 judges per team) and *Copy the previous round*. Press **Save assignments**; judges see their list straight away.
6. **Schedule**: check-in, rounds, meals, code freeze. *Round / judging* and *Deadline* items appear as markers on the dial.

### During each round

1. Set the round to **Live now**, then **Judging**. Judges can enter marks while a round is *Live* or *Judging* and not yet published.
2. Judges score their teams in the **Judge portal**: marks save as they type, they add comments, and press **Mark as done** for each team. Your Judges page shows each judge's progress (done / assigned).
3. In **Rounds & scores**, grey numbers are the **average of the assigned judges' marks**. That average is the official score. Type a number to **override** it for a team; clear it to go back to the average. The **Judges** column (e.g. `1/2`) opens each judge's marks and comments.
   You can also skip judges and enter all scores yourself, as before.
4. For elimination rounds, set each team's decision, or use **Select top teams** (ties at the cut-off all go through).
5. Click **Publish results**. Teams see their scores, decision, your comments and the judges' comments, labelled *Judge 1*, *Judge 2*… (never the judge's name). Publishing locks the judges' marks for that round.

Teams **never** see a round until you publish it. Only teams **selected** in a round appear in the next round.

## 3. Ideathon (organisers)

There are no rounds, scores or eliminations: teams work on their idea for the whole 24 hours.

1. **Settings**: event details, and the **Idea submission** switches:
   - *Collect ideas through the portal*: turn off if you don't need it, and the "My idea" page disappears for teams.
   - *Accepting submissions*, plus an optional **deadline**. Teams can edit their idea until then.
2. **Teams**: import or add teams (IDs `IDE001`, …).
3. **Ideas**: every team's latest idea (problem, solution, impact, links), and who hasn't submitted. **Export CSV** for the jury.
4. **Results**: type an award for the winners (*Winner*, *First runner-up*, *Best social impact*…) and an optional note for any team, then **Publish results**. Each team sees its award and note on its dashboard.

## 4. Announcements

Choose a priority (**Urgent** shows a red banner on every screen) and who receives it:

- Hackathon: Hackathon teams & judges, teams still competing, one team, judges only, or **everyone** (both competitions).
- Ideathon: all Ideathon teams, one team, or **everyone** (both competitions).

---

## 5. Put it online

The app is a single Node process with a single database file (`data/genesis.db`). **The only hard requirement is that the database file survives restarts.** Some free hosts wipe the disk on every restart or deploy, which would lose all scores mid-event.

### Option A: Railway (easiest; about $5 for the month)

1. Push this folder to a GitHub repository (`.gitignore` already excludes `data/`, `.env` and `node_modules/`).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**.
3. On the service, open **Volumes** and add a volume with mount path `/data`.
4. Under **Variables**, add `DATA_DIR` = `/data` and strong passwords for `ADMIN1_PASSWORD`, `ADMIN2_PASSWORD`, `IDEA_ADMIN1_PASSWORD`, `IDEA_ADMIN2_PASSWORD`.
5. Railway runs `npm install` and `npm start` automatically. Under **Settings → Networking**, click **Generate Domain**.

### Option B: Render

Use a **paid** instance (Starter) with a **Persistent Disk** mounted at `/data`, and set `DATA_DIR=/data`. Build command `npm install`, start command `npm start`. The free tier has no persistent disk, so **don't use it** for the event.

### Option C: Your own VPS (DigitalOcean, AWS Lightsail, college server)

```bash
# on the server (Ubuntu), with Node 22+ installed
git clone <your repo> genesis && cd genesis
npm install --omit=dev
cp .env.example .env    # set the organiser passwords
npm install -g pm2
pm2 start npm --name genesis -- start
pm2 save && pm2 startup
```

Put nginx (or Caddy) in front for HTTPS. For nginx, keep live updates working by turning off buffering on `/api/events`:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;          # needed for live updates
  proxy_read_timeout 1h;
}
```

### Option D: A laptop at the venue

Run `npm start` on a laptop that stays plugged in, with `TRUST_PROXY=0` in `.env`. Teams on the same Wi-Fi open `http://<laptop-ip>:3000` (find the IP with `ipconfig`). Allow Node through the Windows firewall when prompted.
To get a public HTTPS link without a server, run a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/): `cloudflared tunnel --url http://localhost:3000`. In that case, leave `TRUST_PROXY` at `1`.

### Option E: Free, on GitHub Pages + Supabase (no server at all)

The same website also runs as a static site on **github.io**, with the data in a free **Supabase** database. The server logic lives in `supabase/schema.sql` as database functions.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. Running it again later is safe and keeps your data; that's how you apply updates (including upgrading an older Hackathon-only database).
3. In the same editor, create the organiser logins (use your own strong passwords):
   ```sql
   select genesis.create_admin('admin1', 'Organiser 1', 'a-strong-password-1');
   select genesis.create_admin('admin2', 'Organiser 2', 'a-strong-password-2');
   select genesis.create_admin('ideaadmin1', 'Ideathon Organiser 1', 'a-strong-password-3', 'ideathon');
   select genesis.create_admin('ideaadmin2', 'Ideathon Organiser 2', 'a-strong-password-4', 'ideathon');
   ```
   The same command resets an organiser's password if one is ever forgotten.
4. Build the website with your **Project URL** and **publishable (anon) key** from *Project Settings → API Keys*. Never use the secret/service_role key; the script refuses it.
   ```bash
   node scripts/build-site.js --url https://YOUR-PROJECT.supabase.co --key YOUR-PUBLISHABLE-KEY --out ../genesis-hackathon-site
   ```
5. Push that folder to a **public** GitHub repository and turn on **Settings → Pages → Deploy from a branch → main / (root)**. The site appears at `https://<your-username>.github.io/<repo-name>/`. Add `#hackathon` or `#ideathon` to the link to skip the competition choice.

   **Automatic publishing (how AVV-IIC/Genesis-2026 runs):** the workflow in `.github/workflows/website.yml` runs on every push to `main`. It builds the site using the Supabase URL and publishable key saved in `site.config.json`, and puts the result on the `gh-pages` branch. Pages is set to **Deploy from a branch → gh-pages / (root)**. To change the website, edit the source, push to `main`, and it's live a minute later. Database changes still need `supabase/schema.sql` re-run in the SQL Editor *first*.

How it stays secure: the tables live in a private `genesis` schema that the public key can't read. The website can only call the `api_*` functions, and every one of them checks the signed-in user's session, role and competition. Passwords are stored as bcrypt hashes. Live updates use Supabase Realtime broadcasts that contain only "something changed" signals, never scores, comments or ideas. If live updates can't connect, pages refresh themselves every 45 seconds and show "Auto-refresh".

Limits of the free plan: Supabase pauses a free project after about a week with no activity (open the dashboard and click *Restore*). The free database and bandwidth are far more than a hackathon needs.

---

## 6. Event-day checklist

- [ ] Real start/end times set in **both** consoles' Settings; demo data deleted.
- [ ] All organisers have signed in and changed their passwords (**Settings → Change my password**).
- [ ] Teams imported and credential slips printed, for both competitions.
- [ ] Hackathon: rounds and criteria reviewed; judges added, slips printed, Round 1 assignments saved.
- [ ] Ideathon: idea submission switched on or off, deadline set.
- [ ] Schedule entered (shared items marked "Also show in the other competition").
- [ ] **Download a backup** (Settings → Data) before and after each round.
- [ ] Decide whether to show the Hackathon leaderboard.

## 7. Backups and recovery

- **Settings → Data → Full backup** downloads everything for that competition (never passwords).
- To restore the laptop/server version: stop the server, replace `data/genesis.db` (or `$DATA_DIR/genesis.db`) with a copy of the file, and start it again.
- **Results CSV**: Hackathon ranks, per-round totals, decisions and notes; Ideathon awards and notes. **Ideas CSV**: every Ideathon idea. All open in Excel.
- Forgot an organiser password? Another organiser of the same competition can reset it in **Settings**. If everyone is locked out, run this on the server:
  ```bash
  npm run reset-admin -- admin1
  ```
  (`npm run reset-admin -- list` shows all accounts; add `--ideathon` to create a new Ideathon organiser.)
- Forgot a judge's password? **Judges → key icon** on the judge.

## 8. Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the database. Point it at a persistent disk in the cloud |
| `ADMIN1_USERNAME` / `ADMIN1_PASSWORD` / `ADMIN1_NAME` | `admin1` / random / `Organiser 1` | First Hackathon organiser, created on first start |
| `ADMIN2_USERNAME` / `ADMIN2_PASSWORD` / `ADMIN2_NAME` | `admin2` / random / `Organiser 2` | Second Hackathon organiser |
| `IDEA_ADMIN1_USERNAME` / `IDEA_ADMIN1_PASSWORD` / `IDEA_ADMIN1_NAME` | `ideaadmin1` / random / `Ideathon Organiser 1` | First Ideathon organiser |
| `IDEA_ADMIN2_USERNAME` / `IDEA_ADMIN2_PASSWORD` / `IDEA_ADMIN2_NAME` | `ideaadmin2` / random / `Ideathon Organiser 2` | Second Ideathon organiser |
| `TRUST_PROXY` | `1` | Number of proxies in front (use `0` on a bare laptop/LAN) |
| `SESSION_DAYS` | `7` | How long a sign-in lasts |

## 9. How it's built

```
server/
  index.js            app setup, security headers, pages, first-run organiser accounts
  db.js               SQLite schema and upgrades, default rounds and criteria, per-competition settings
  auth.js             scrypt password hashing, sessions, login throttling, CSRF guard
  events.js           live updates (Server-Sent Events), targeted per competition and role
  services/results.js standings, eliminations, judges' averages, leaderboard, score sheet: the core rules
  routes/             auth, public, team, judge, admin (teams, judges, rounds, ideathon, content, system)
supabase/schema.sql   the same rules as Postgres functions, for the GitHub Pages version
public/
  index.html team.html judge.html admin.html
  css/app.css         the whole design system
  js/core.js          safe HTML templating, API client, dialogs, toasts, live stream
  js/backend.js       maps the API onto Supabase in the static version
  js/dial.js          the 24-hour countdown dial and dawn glow
  js/portal.js        announcement cards and schedule timeline shared by team and judge portals
  js/team/main.js     team leader portal (Hackathon and Ideathon)
  js/judge/main.js    judge portal
  js/admin/*.js       organiser console, one file per page
scripts/              seed-demo, reset-admin, build-site
tests/                SQL tests (PGlite) and HTTP tests for the Node server
```

Run the tests with `node tests/sql.test.mjs` and `node tests/node.test.mjs`.

- **Security:** passwords are hashed (scrypt on the server, bcrypt in Supabase); sessions use HttpOnly SameSite cookies stored server-side; mutating requests need a custom header (CSRF protection); sign-in is throttled per account; strict Content-Security-Policy; all output is HTML-escaped. Every request is checked against the signed-in role **and competition**, so an Ideathon organiser can't read Hackathon data and a judge only sees assigned teams.
- **Fonts** (Big Shoulders Display, Figtree, Martian Mono; SIL Open Font License) are bundled in `public/fonts`, so the site works on a venue network without internet.
- **Logo and theme:** the Genesis logo is in `public/img/` (`logo.png` has a transparent background, `logo-sm.png` is for headers, and there are favicons and app icons). The colour palette in `public/css/app.css` (`:root` tokens) is taken from the logo. To swap the logo, replace those PNG files and keep the same names.

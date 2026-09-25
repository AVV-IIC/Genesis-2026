# Genesis Hackathon portal

A web portal for running a 24-hour hackathon with 4 evaluation rounds.

- **Team leaders** sign in with a team ID and password from the organisers. They see their live status (selected / not selected / pending), a scorecard with per-criterion scores and judges' notes, announcements, the schedule, a help desk, and an optional leaderboard.
- **Organisers** (2 admin accounts) manage teams, enter scores, decide who goes through, publish results, post announcements, answer help requests, and edit the schedule.

Everything updates live. When you publish results or post an announcement, every open team screen updates within a second, with no refresh needed.

---

## 1. Run it on your computer

You need **Node.js 22.13 or newer** (`node --version`). Nothing else: the database is built into Node.

```bash
cd D:\Genesis_Hackathon
npm install
npm start
```

Open <http://localhost:3000>.

The **first time** it starts, it creates the two organiser accounts and prints their passwords in the terminal:

```
  Organiser accounts created:
    admin1       Xk3...
    admin2       p9Q...
```

Save them. To choose your own passwords instead, copy `.env.example` to `.env` and fill in `ADMIN1_PASSWORD` / `ADMIN2_PASSWORD` **before** the first start.

### Try it with demo data

```bash
npm run seed-demo
npm start
```

This adds 12 sample teams mid-event (Rounds 1 and 2 published, Round 3 live). Every demo team signs in with password `demo-pass` (team IDs `GEN001` … `GEN012`).
Clear it before the real event: **Settings → Danger zone → Delete teams & all event data**.

---

## 2. Set up your event (organisers)

1. **Settings**: set the event name, venue, and the start and end time (this drives the 24-hour countdown dial). Add help desk contact numbers.
2. **Rounds & scores → Round settings & criteria**: rename rounds and edit the scoring criteria for each round (for example Innovation /10). Round 1 is set to *no eliminations*, Rounds 2–4 to *elimination*. You can change both.
3. **Teams → Import CSV**: download the template, fill it in Excel/Google Sheets, and upload. Team IDs (`GEN001`, …) and passwords are generated automatically. A window then shows every password once, with **Print slips** (cut-out credential slips) and **Download CSV**.
   - Lost a slip? Use the key icon on the team to **reset the password**.
   - Need to reprint everything? **New passwords for all** regenerates and prints all of them.
4. **Schedule**: add check-in, rounds, meals, and the code freeze. Items of type *Round / judging* or *Deadline* appear as markers on the countdown dial. Titles with "Round 1", "Round 2"… are labelled R1, R2.

### During each round

1. Set the round state to **Live now** (teams see "Round 2 is on"), then **Judging** once judging starts.
2. Enter scores in the sheet. They **save automatically** as you type (green dot = saved). Press **Enter** to jump to the next team. Click **Add notes** to write judges' comments or an award such as *Winner* or *Best UI*.
   Both organisers can enter scores at the same time. Changes made by the other admin appear live.
3. For elimination rounds, set each team's decision, or use **Select top teams** (for example top 8; ties at the cut-off all go through).
4. Click **Publish results**. Teams instantly see their scores, notes, and whether they're selected. Tick the box to post an automatic announcement too.
   Only teams **selected** in a round appear in the next round's score sheet.

Teams **never** see a round's scores or decisions until you publish it. You can unpublish at any time.

### Announcements

Choose a priority (**Urgent** shows a red banner on every team's screen) and who receives it: all teams, only teams still competing, or one specific team. Pin important posts to keep them on top.

---

## 3. Put it online

The app is a single Node process with a single database file (`data/genesis.db`). **The only hard requirement is that the database file survives restarts.** Some free hosts wipe the disk on every restart or deploy, which would lose all scores mid-event.

### Option A: Railway (easiest; about $5 for the month)

1. Push this folder to a GitHub repository (`.gitignore` already excludes `data/`, `.env` and `node_modules/`).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**.
3. On the service, open **Volumes** and add a volume with mount path `/data`.
4. Under **Variables**, add:
   - `DATA_DIR` = `/data`
   - `ADMIN1_PASSWORD` = *(a strong password)*
   - `ADMIN2_PASSWORD` = *(a strong password)*
5. Railway runs `npm install` and `npm start` automatically. Under **Settings → Networking**, click **Generate Domain** to get your `https://….up.railway.app` link.

### Option B: Render

Use a **paid** instance (Starter) with a **Persistent Disk** mounted at `/data`, and set `DATA_DIR=/data`. Build command `npm install`, start command `npm start`. The free tier has no persistent disk, so **don't use it** for the event.

### Option C: Your own VPS (DigitalOcean, AWS Lightsail, college server)

```bash
# on the server (Ubuntu), with Node 22+ installed
git clone <your repo> genesis && cd genesis
npm install --omit=dev
cp .env.example .env    # set ADMIN passwords
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

---

## 4. Event-day checklist

- [ ] Real event start/end time set in **Settings**; demo data deleted.
- [ ] Both organisers have signed in and changed their passwords (**Settings → Change my password**).
- [ ] Teams imported, credential slips printed.
- [ ] Rounds and criteria reviewed.
- [ ] Schedule entered.
- [ ] **Download a database backup** (Settings → Data) before and after each round.
- [ ] Decide whether to show the leaderboard (Leaderboard page or Settings).

## 5. Backups and recovery

- **Settings → Data → Database backup** downloads a complete copy of everything.
- To restore: stop the server, replace `data/genesis.db` (or `$DATA_DIR/genesis.db`) with the backup file, and start it again.
- **Results CSV** gives final ranks, per-round totals, decisions and judges' notes. It opens in Excel.
- Forgot an organiser password? The other organiser can reset it in **Settings**. If both are locked out, run this on the server:
  ```bash
  npm run reset-admin -- admin1
  ```

## 6. Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the database. Point it at a persistent disk in the cloud |
| `ADMIN1_USERNAME` / `ADMIN1_PASSWORD` / `ADMIN1_NAME` | `admin1` / random / `Organiser 1` | First organiser, created on first start |
| `ADMIN2_USERNAME` / `ADMIN2_PASSWORD` / `ADMIN2_NAME` | `admin2` / random / `Organiser 2` | Second organiser |
| `TRUST_PROXY` | `1` | Number of proxies in front (use `0` on a bare laptop/LAN) |
| `SESSION_DAYS` | `7` | How long a sign-in lasts |

## 7. How it's built

```
server/
  index.js            app setup, security headers, pages, first-run admin accounts
  db.js               SQLite schema, default rounds and criteria, settings
  auth.js             scrypt password hashing, sessions, login throttling, CSRF guard
  events.js           live updates (Server-Sent Events)
  services/results.js standings, eliminations, leaderboard, score sheet: the core rules
  routes/             team, admin (teams, rounds, content, system), auth, public
public/
  index.html team.html admin.html
  css/app.css         the whole design system
  js/core.js          safe HTML templating, API client, dialogs, toasts, live stream
  js/dial.js          the 24-hour countdown dial and dawn glow
  js/team/main.js     team leader portal
  js/admin/*.js       organiser console, one file per page
scripts/              seed-demo, reset-admin
```

- **Security:** passwords are hashed with scrypt; sessions use HttpOnly SameSite cookies stored server-side; mutating requests need a custom header (CSRF protection); sign-in is throttled per account; strict Content-Security-Policy; all output is HTML-escaped.
- **Fonts** (Big Shoulders Display, Figtree, Martian Mono; SIL Open Font License) are bundled in `public/fonts`, so the site works on a venue network without internet.
- **Logo and theme:** the Genesis logo is in `public/img/` (`logo.png` has a transparent background, `logo-sm.png` is for headers, and there are favicons and app icons). The colour palette in `public/css/app.css` (`:root` tokens) is taken from the logo. To swap the logo, replace those PNG files and keep the same names.

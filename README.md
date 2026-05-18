# BEE — Becoming Effective Executives

A tiny, mobile-first time-log inspired by Peter Drucker's *The Effective Executive*.
Plan the night before in **15-minute blocks**. Next day, tick what you actually followed.
Goal: **80 % effectiveness**. Built-in focus timer with a bell, and a Trends view with
30-day line, weekly bars, and a heatmap.

## Run it

It's a single-page static app — no build step.

```bash
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080 on your phone (same Wi-Fi) or laptop
```

Or drop the folder into any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel static).
All data lives in your browser's `localStorage` under the key `bee.v1`.

### Install on iPhone / Android

Open the site in Safari or Chrome → **Share → Add to Home Screen**. You get an
app icon; the included `manifest.webmanifest` makes it launch full-screen.

## How it works

- **Plan** (left column): type what you intend to do for each **15-minute** block.
- **Actual** (right column):
  - Tap **✓** if you followed the plan → **+1 point**.
  - Tap **✗** if you deviated → a box opens for what you actually did (no score).
- **Effectiveness % = points ÷ planned slots**. Empty blocks don't count.
- **Timer**: tap **▶** on a row to start a 15-min focus timer for that block — or
  use the floating timer pill below the header (5 / 15 / 25 / 45 / 60 min). A bell
  rings when it ends and offers to mark the slot as ✓.
- Blocks from **00:00–06:00** and **22:00–24:00** are collapsed by default to
  keep the list short; expand when a day needs it.
- The date, day of the week, and a Drucker quote are filled in automatically.
- After 8 pm, a banner reminds you to plan tomorrow.
- **Trends** shows a 30-day line of effectiveness with the 80 % goal line,
  the last 12 weeks as bars, and a GitHub-style heatmap.
- **History** lists every past day so you can re-open one.

## Exports

- **Download CSV** — one row per planned/actual slot across every day.
- **Download JSON** — full backup of the local store.
- **Copy today as text** — paste into a journal, email, or Slack.
- **Push to Google Sheet** — optional; see setup below.

## Cross-device sync (Supabase, optional)

BEE syncs across your phone and laptop via your own free Supabase project.

1. Sign up at [supabase.com](https://supabase.com) and create a new project (free tier).
2. In the project, open **SQL editor**, paste the contents of [`supabase.sql`](./supabase.sql), and run it. This creates the `bee_days` table with row-level security.
3. Go to **Project Settings → API** and copy:
   - the **Project URL** (`https://YOUR-PROJECT.supabase.co`)
   - the **anon** `public` key
4. In BEE, tap **Cloud setup…** in the "Cloud & account" card and paste both. Save.
5. Tap **Sign in** and enter your email — Supabase emails you a magic link. Click it on each device once; the session persists.
6. From then on every change writes locally *and* pushes to your project. Open BEE on a different device, sign in with the same email, and your data appears.

Data lives only in your project — nobody else can read it; row-level security enforces that you can only see rows where `user_id = auth.uid()`.

## Google Sheets export (legacy)

BEE pushes each day's log to a Google Sheet via a small Apps Script web app.
You own the sheet; no third-party server is involved.

1. Create a new Google Sheet.
2. **Extensions → Apps Script**. Paste the contents of [`google-apps-script.js`](./google-apps-script.js) into `Code.gs` and save.
3. *(Optional)* Edit `SECRET` at the top of the script to a string only you know.
4. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Copy the `/exec` URL. In BEE, tap **Configure…** under "Export & sync" and paste the URL (and the secret if you set one).
6. Tap **Push to Google Sheet**. Two tabs appear in your sheet:
   - **BEE** — detailed log, one row per slot.
   - **Daily** — one row per day with 7-day and 30-day rolling average %.

A simple chart on the **Daily** tab (Insert → Chart → Line, series = Pct, Rolling7, Rolling30) gives you a monthly effectiveness curve.

## What's pinned in the UI

- *"Right now: get out of the house for work."* — permanent nudge.
- *"Plan tomorrow, tonight — always."* — appears as a banner after 8 pm if tomorrow has fewer than 4 planned slots.
- *"The night-before plan is the point."* — always visible, small.

## File map

```
index.html              — markup, timer pill, modals
styles.css              — light/dark, mobile-first, charts, timer
app.js                  — state, slots, timer, charts, sync, export
quotes.js               — Drucker quotes, deterministic daily rotation
supabase.sql            — schema + RLS for cloud sync (run once)
google-apps-script.js   — legacy Apps Script for Sheets export
manifest.webmanifest    — PWA metadata
```

## Ideas to consider later

- Weekly review prompt (Sunday night) summarising where the 20 % deviation went.
- Tagging slots (deep work / admin / meetings) and showing a pie of real time.
- A "waste log": aggregate the `actual` notes into the most-common interruptions.
- Share read-only Sheet link in the app so you can glance at the chart on mobile.

## Credit

All quotes by Peter F. Drucker, mostly from *The Effective Executive* (1967).

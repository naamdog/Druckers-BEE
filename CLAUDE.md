# BEE — Druckers-BEE

**BEE** stands for **Becoming Effective Executives**.

A static, single-page PWA inspired by Peter Drucker's *The Effective Executive*.
15-minute time-log with plan/actual columns, scoring 1 point per followed block,
target 80% effectiveness. Built-in 15-min focus timer with a Web Audio bell.
Charts (line + weekly bars + heatmap) in a Trends modal.

**Live URL:** https://naamdog.github.io/Druckers-BEE/
**Hosting:** GitHub Pages, deployed from `main` / root.

## Stack

- No build step. Plain HTML/CSS/vanilla JS.
- Local-first: every change writes `localStorage` under key `bee.v1`.
- Cloud sync (optional): user-owned Supabase project. Schema in
  `supabase.sql`. JS client loaded from jsDelivr UMD. Magic-link auth.
  Each day is one row in `bee_days(user_id, date, plans jsonb,
  actuals jsonb)` with row-level security scoped to `auth.uid()`.
- Legacy Google Sheets push is still available behind the `<details>`
  in the Export card; don't expand its surface.

## File map

```
index.html              markup, timer pill, modals
styles.css              light/dark theme, charts, timer pill
app.js                  one IIFE; sections separated by big banners
quotes.js               Drucker quotes, deterministic daily rotation
supabase.sql            schema + RLS — run once in user's project
google-apps-script.js   legacy Apps Script for Sheets export
manifest.webmanifest    PWA metadata
```

## Working agreements (apply to every session in this repo)

1. **Always provide the live web URL** alongside any fix or change so the user
   can refresh and verify on their phone:
   `https://naamdog.github.io/Druckers-BEE/`.
2. **Merge fixes immediately** after pushing the PR — don't wait for the user
   to click merge. Use squash merge. Skip this rule only if the change is
   ambiguous, architecturally significant, or the user has explicitly asked to
   review first.
3. After merging, remind the user GitHub Pages takes ~60 s to redeploy and
   that they may need to hard-refresh (or close + reopen the PWA) to pick up
   new CSS/JS.
4. Develop on a topic branch (e.g. `fix/<thing>` or `feat/<thing>`), never push
   directly to `main`.
5. Don't add CI, build pipelines, or frameworks. Keep it a static site.
6. Don't change the "Get out of the house for work" pinned reminder or the
   "Plan tomorrow, tonight — always" banner copy without explicit instruction.
7. The daily quote source is Peter F. Drucker (mostly *The Effective
   Executive*). Don't swap to other authors without the user asking.

## Common tasks

- **Run locally:** `python3 -m http.server 8080` and visit
  `http://localhost:8080`.
- **Wipe local data while testing:** click "wipe local data" in the footer, or
  `localStorage.removeItem('bee.v1')` in the dev console.
- **Cache-bust on style/JS changes:** bump the `?v=N` query in
  `index.html`'s `styles.css` / `app.js` / `quotes.js` references.
  iOS PWAs cache aggressively without it.
- **Slot granularity:** 15 minutes — 96 slots/day. The 30-min → 15-min
  migration runs once per device against `state.days`. Don't undo it.

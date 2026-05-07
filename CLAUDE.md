# BEE — Druckers-BEE

A static, single-page PWA inspired by Peter Drucker's *The Effective Executive*.
30-minute time-log with plan/actual columns, scoring 1 point per followed block,
target 80% effectiveness.

**Live URL:** https://naamdog.github.io/Druckers-BEE/
**Hosting:** GitHub Pages, deployed from `main` / root.

## Stack

- No build step. Plain HTML/CSS/vanilla JS.
- Data persisted in `localStorage` under key `bee.v1`.
- Optional Google Sheets sync via a user-hosted Apps Script web app
  (`google-apps-script.js`).

## File map

```
index.html              markup, modals, dialogs
styles.css              light/dark theme, mobile-first
app.js                  state, slot rendering, scoring, export, sheets push
quotes.js               Drucker quotes, deterministic daily rotation
google-apps-script.js   paste into Apps Script for Sheets sync
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

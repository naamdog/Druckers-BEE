/* BEE — Becoming Effective Executives
   Local-first time log with optional Supabase sync.

   Storage:
     localStorage["bee.v1"] = {
       version: 2,
       days: { "YYYY-MM-DD": { plans: {HH:MM:str}, actuals: {HH:MM:{status,note}} } },
       sheets: { url, secret },
       supabase: { url, anonKey },
       migrated: { from30min: true }
     }
*/

(() => {
  "use strict";

  // ============================================================
  // Constants & helpers
  // ============================================================
  const STORAGE_KEY = "bee.v1";
  const DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const SLOT_MINUTES = 15;
  const STATE_VERSION = 2;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseDateKey = (k) => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
  const addDays = (d, n) => { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; };
  const todayKey = () => fmtDateKey(new Date());
  const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // 96 15-minute slots: 00:00, 00:15, … 23:45
  const SLOTS = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      SLOTS.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  const groupFor = (slot) => {
    const h = parseInt(slot.slice(0, 2), 10);
    if (h < 6) return "early";
    if (h >= 22) return "late";
    return "day";
  };
  const slotIsHourMark = (slot) => slot.endsWith(":00");
  const nowSlot = () => {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(Math.floor(d.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES)}`;
  };

  // ============================================================
  // State
  // ============================================================
  let state = loadState();
  let currentDateKey = todayKey();
  let supabaseClient = null;
  let session = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      if (!parsed.days) parsed.days = {};
      if (!parsed.sheets) parsed.sheets = {};
      if (!parsed.supabase) parsed.supabase = {};
      if (!parsed.migrated) parsed.migrated = {};
      parsed.version = STATE_VERSION;
      return parsed;
    } catch {
      return freshState();
    }
  }
  function freshState() {
    return { version: STATE_VERSION, days: {}, sheets: {}, supabase: {}, migrated: {} };
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("save failed", e); }
  }
  function dayFor(key) {
    if (!state.days[key]) state.days[key] = { plans: {}, actuals: {} };
    return state.days[key];
  }

  // One-time migration: split 30-min slots into two 15-min children.
  function migrate30to15() {
    if (state.migrated?.from30min) return;
    let touched = 0;
    for (const k of Object.keys(state.days)) {
      const d = state.days[k];
      // Detect 30-min data: any plan key that ends in :00 or :30 only.
      const planKeys = Object.keys(d.plans || {});
      const wasThirty = planKeys.length && planKeys.every(s => s.endsWith(":00") || s.endsWith(":30"));
      if (!planKeys.length || !wasThirty) continue;
      const newPlans = {}, newActuals = {};
      for (const slot of planKeys) {
        const [h, m] = slot.split(":").map(Number);
        const child = `${pad2(h)}:${pad2(m + 15)}`;
        newPlans[slot] = d.plans[slot];
        newPlans[child] = d.plans[slot];
      }
      for (const slot of Object.keys(d.actuals || {})) {
        const [h, m] = slot.split(":").map(Number);
        const child = `${pad2(h)}:${pad2(m + 15)}`;
        newActuals[slot] = d.actuals[slot];
        newActuals[child] = JSON.parse(JSON.stringify(d.actuals[slot]));
      }
      d.plans = newPlans;
      d.actuals = newActuals;
      touched++;
    }
    state.migrated.from30min = true;
    saveState();
    if (touched) console.info(`Migrated ${touched} day(s) from 30-min to 15-min slots.`);
  }

  // ============================================================
  // Theme
  // ============================================================
  const THEME_KEY = "bee.theme";
  const THEME_ORDER = ["auto", "light", "dark"];
  const THEME_ICON  = { auto: "◐", light: "☀", dark: "☾" };
  const THEME_LABEL = { auto: "Theme: auto (system)", light: "Theme: light", dark: "Theme: dark" };

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    const icon = $("#theme-icon");
    const btn = $("#theme-toggle");
    if (icon) icon.textContent = THEME_ICON[theme] || THEME_ICON.auto;
    if (btn) {
      btn.title = THEME_LABEL[theme] || THEME_LABEL.auto;
      btn.setAttribute("aria-label", btn.title);
    }
  }
  const loadTheme = () => {
    const t = localStorage.getItem(THEME_KEY);
    return THEME_ORDER.includes(t) ? t : "auto";
  };
  function wireThemeToggle() {
    const btn = $("#theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(loadTheme()) + 1) % THEME_ORDER.length];
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  // ============================================================
  // Header & quote
  // ============================================================
  function renderHeader() {
    const d = parseDateKey(currentDateKey);
    $("#dow").textContent = DOW[d.getDay()];
    $("#dmy").textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function renderQuote() {
    const qs = window.DRUCKER_QUOTES || [];
    if (!qs.length) return;
    const d = parseDateKey(currentDateKey);
    const idx = (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()) % qs.length;
    const q = qs[idx];
    $("#quote").textContent = `“${q.text}”`;
    $("#quote-source").textContent = `— Peter F. Drucker · ${q.source}`;
  }

  // ============================================================
  // Slot rendering
  // ============================================================
  function renderSlots() {
    const dayData = dayFor(currentDateKey);
    const isToday = currentDateKey === todayKey();
    const now = isToday ? nowSlot() : null;
    const activeTimerSlot = timer.slot;

    for (const g of ["early", "day", "late"]) {
      const body = $(`[data-group-body="${g}"]`);
      body.innerHTML = "";
      for (const slot of SLOTS) {
        if (groupFor(slot) !== g) continue;
        body.appendChild(buildSlotRow(slot, dayData, slot === now, slot === activeTimerSlot));
      }
    }
    updateGroupMeta();
    updateScore();
  }

  function buildSlotRow(slot, dayData, isNow, isActiveTimer) {
    const row = document.createElement("div");
    row.className = "slot";
    if (slotIsHourMark(slot)) row.classList.add("hour-mark");
    if (isNow) row.classList.add("now");
    if (isActiveTimer) row.classList.add("active-timer");
    row.dataset.slot = slot;

    const actual = dayData.actuals[slot];
    if (actual?.status === "done") row.classList.add("done");
    if (actual?.status === "missed") row.classList.add("missed");

    const time = document.createElement("div");
    time.className = "slot-time";
    time.textContent = slot;
    row.appendChild(time);

    const main = document.createElement("div");
    main.className = "slot-main";

    const plan = document.createElement("input");
    plan.type = "text";
    plan.className = "slot-plan";
    plan.placeholder = "Plan…";
    plan.value = dayData.plans[slot] || "";
    plan.addEventListener("input", () => {
      const v = plan.value.trim();
      if (v) dayData.plans[slot] = v;
      else delete dayData.plans[slot];
      saveState();
      schedulePush(currentDateKey);
      updateGroupMeta();
      updateScore();
    });
    main.appendChild(plan);

    if (actual?.status === "missed" && actual.note) {
      const a = document.createElement("div");
      a.className = "slot-actual";
      a.innerHTML = `<span class="tag missed">Actual</span> ${escapeHtml(actual.note)}`;
      main.appendChild(a);
    }
    row.appendChild(main);

    const status = document.createElement("div");
    status.className = "slot-status";

    const btnTimer = document.createElement("button");
    btnTimer.className = "btn-timer" + (isActiveTimer ? " active" : "");
    btnTimer.type = "button";
    btnTimer.title = "Start timer for this slot";
    btnTimer.textContent = isActiveTimer ? "■" : "▶";
    btnTimer.addEventListener("click", () => timerStartForSlot(slot));

    const btnCheck = document.createElement("button");
    btnCheck.className = "btn-check" + (actual?.status === "done" ? " active" : "");
    btnCheck.type = "button";
    btnCheck.setAttribute("aria-label", "Followed the plan");
    btnCheck.textContent = "✓";
    btnCheck.addEventListener("click", () => toggleDone(slot));

    const btnX = document.createElement("button");
    btnX.className = "btn-x" + (actual?.status === "missed" ? " active" : "");
    btnX.type = "button";
    btnX.setAttribute("aria-label", "Deviated from the plan");
    btnX.textContent = "✗";
    btnX.addEventListener("click", () => openDeviation(slot));

    status.appendChild(btnTimer);
    status.appendChild(btnCheck);
    status.appendChild(btnX);
    row.appendChild(status);

    return row;
  }

  function toggleDone(slot) {
    const d = dayFor(currentDateKey);
    if (d.actuals[slot]?.status === "done") delete d.actuals[slot];
    else d.actuals[slot] = { status: "done" };
    saveState();
    schedulePush(currentDateKey);
    renderSlots();
  }

  function openDeviation(slot) {
    const d = dayFor(currentDateKey);
    const modal = $("#deviation-modal");
    const ta = $("#deviation-text");
    const sub = $("#deviation-sub");
    const plan = d.plans[slot] || "(no plan set)";
    sub.textContent = `${slot} · Plan was: ${plan}`;
    ta.value = d.actuals[slot]?.note || "";

    const save = () => {
      d.actuals[slot] = { status: "missed", note: ta.value.trim() };
      saveState();
      schedulePush(currentDateKey);
      modal.close();
      renderSlots();
    };
    const clear = () => {
      delete d.actuals[slot];
      saveState();
      schedulePush(currentDateKey);
      modal.close();
      renderSlots();
    };
    $("#deviation-save").onclick = save;
    const isMissed = d.actuals[slot]?.status === "missed";
    $("#deviation-cancel").textContent = isMissed ? "Clear" : "Cancel";
    $("#deviation-cancel").onclick = isMissed ? clear : () => modal.close();

    modal.showModal();
    setTimeout(() => ta.focus(), 20);
  }

  // ============================================================
  // Score, group meta, streak
  // ============================================================
  function statsFor(dayData) {
    let planned = 0, done = 0, missed = 0;
    for (const slot of SLOTS) {
      if (dayData.plans?.[slot]) planned++;
      if (dayData.actuals?.[slot]?.status === "done") done++;
      if (dayData.actuals?.[slot]?.status === "missed") missed++;
    }
    const pct = planned ? Math.round((done / planned) * 100) : 0;
    return { planned, done, missed, pct };
  }

  function updateGroupMeta() {
    const d = dayFor(currentDateKey);
    const gs = (g) => {
      let p=0, ok=0;
      for (const s of SLOTS) {
        if (groupFor(s) !== g) continue;
        if (d.plans[s]) p++;
        if (d.actuals[s]?.status === "done") ok++;
      }
      return { p, ok };
    };
    const fmt = ({ p, ok }) => p ? `${ok}/${p}` : "— empty —";
    $("#meta-early").textContent = fmt(gs("early"));
    $("#meta-late").textContent  = fmt(gs("late"));
  }

  function updateScore() {
    const { planned, done, pct } = statsFor(dayFor(currentDateKey));
    $("#stat-points").textContent = done;
    $("#stat-planned").textContent = planned;
    $("#ring-pct").textContent = `${pct}%`;

    const C = 2 * Math.PI * 52;
    const fill = $("#ring-fill");
    fill.style.strokeDashoffset = String(C * (1 - Math.min(pct, 100) / 100));
    fill.classList.remove("below", "low");
    if (pct < 50) fill.classList.add("low");
    else if (pct < 80) fill.classList.add("below");

    $("#stat-streak").textContent = computeStreak();
  }

  function computeStreak() {
    let streak = 0;
    let cursor = new Date();
    const tStats = statsFor(dayFor(todayKey()));
    if (!(tStats.planned >= 12 && tStats.pct >= 80)) cursor = addDays(cursor, -1);
    for (let i = 0; i < 365; i++) {
      const k = fmtDateKey(cursor);
      const day = state.days[k];
      if (!day) break;
      const s = statsFor(day);
      if (s.planned >= 12 && s.pct >= 80) { streak++; cursor = addDays(cursor, -1); }
      else break;
    }
    return streak;
  }

  // ============================================================
  // Plan-tomorrow banner
  // ============================================================
  function maybeShowPlanTomorrow() {
    const now = new Date();
    if (now.getHours() < 20) return;
    const tomorrow = fmtDateKey(addDays(now, 1));
    const td = state.days[tomorrow];
    const cnt = td ? Object.keys(td.plans).filter(k => td.plans[k]).length : 0;
    if (cnt < 8) $("#plan-tomorrow-banner").hidden = false;
  }

  // ============================================================
  // Group toggle, day nav, scroll-to-now
  // ============================================================
  function wireGroupToggles() {
    $$(".group-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.group;
        const body = $(`[data-group-body="${g}"]`);
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        body.hidden = open;
      });
    });
  }
  function wireNav() {
    $("#prev-day").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(parseDateKey(currentDateKey), -1));
      pullDay(currentDateKey).finally(renderAll);
    });
    $("#next-day").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(parseDateKey(currentDateKey), 1));
      pullDay(currentDateKey).finally(renderAll);
    });
    $("#today-btn").addEventListener("click", () => {
      currentDateKey = todayKey();
      pullDay(currentDateKey).finally(renderAll);
    });
    $("#open-tomorrow").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(new Date(), 1));
      pullDay(currentDateKey).finally(renderAll);
    });
    $("#scroll-now-btn").addEventListener("click", () => {
      const row = $(`.slot[data-slot="${nowSlot()}"]`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ============================================================
  // History modal
  // ============================================================
  function openHistory() {
    const modal = $("#history-modal");
    const body = $("#history-body");
    const keys = Object.keys(state.days).sort().reverse();
    if (!keys.length) {
      body.innerHTML = `<p class="muted">Nothing logged yet.</p>`;
    } else {
      const last30 = keys.slice(0, 30).map(k => statsFor(state.days[k])).filter(s => s.planned > 0);
      const avg = last30.length ? Math.round(last30.reduce((a,s) => a+s.pct, 0) / last30.length) : 0;
      const hit80 = last30.filter(s => s.pct >= 80).length;
      body.innerHTML = `
        <div class="card" style="margin-bottom:10px;padding:12px;">
          <strong>Last ${last30.length} logged day(s)</strong><br/>
          Average effectiveness: <strong>${avg}%</strong> · Days ≥ 80%: <strong>${hit80}</strong>
        </div>
        <div id="history-list"></div>`;
      const list = $("#history-list", body);
      keys.forEach(k => {
        const s = statsFor(state.days[k]);
        const d = parseDateKey(k);
        const cls = s.pct >= 80 ? "good" : s.pct >= 50 ? "mid" : "low";
        const row = document.createElement("div");
        row.className = "history-day";
        row.innerHTML = `
          <div>
            <div><strong>${DOW[d.getDay()]}</strong> · ${MONTHS[d.getMonth()]} ${d.getDate()}</div>
            <div class="meta">${s.done}/${s.planned} slots followed${s.missed ? ` · ${s.missed} noted` : ""}</div>
          </div>
          <div class="history-pct ${cls}">${s.planned ? s.pct + "%" : "—"}</div>
          <button class="ghost" data-open="${k}">Open</button>`;
        list.appendChild(row);
      });
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-open]");
        if (!b) return;
        currentDateKey = b.dataset.open;
        modal.close();
        pullDay(currentDateKey).finally(renderAll);
      });
    }
    modal.showModal();
  }

  // ============================================================
  // Trends modal & charts
  // ============================================================
  function openTrends() {
    const modal = $("#trends-modal");
    const days = Object.keys(state.days).sort();
    const series = days
      .map(k => ({ key: k, date: parseDateKey(k), ...statsFor(state.days[k]) }))
      .filter(d => d.planned > 0);

    const summary = $("#trends-summary");
    const last30 = series.slice(-30);
    const avg30 = last30.length ? Math.round(last30.reduce((a,s) => a+s.pct, 0) / last30.length) : 0;
    const hit80 = last30.filter(s => s.pct >= 80).length;
    const best = series.reduce((b, s) => s.pct > (b?.pct ?? -1) ? s : b, null);
    summary.innerHTML = `
      <div><span>${avg30}%</span><small>30-day average</small></div>
      <div><span>${hit80}</span><small>days ≥ 80%</small></div>
      <div><span>${best ? best.pct + "%" : "—"}</span><small>best day</small></div>`;

    $("#chart-line").innerHTML = renderLineChart(last30);
    $("#chart-bars").innerHTML = renderWeeklyBars(series);
    $("#chart-heat").innerHTML = renderHeatmap(series);

    modal.showModal();
  }

  function renderLineChart(points) {
    if (!points.length) return `<p class="muted small">No logged days yet.</p>`;
    const W = 680, H = 200, padL = 30, padR = 10, padT = 10, padB = 24;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const xs = points.map((_, i) => padL + (points.length === 1 ? innerW/2 : i * innerW / (points.length - 1)));
    const ys = points.map(p => padT + innerH * (1 - p.pct / 100));
    const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
    const goalY = padT + innerH * (1 - 0.8);
    const gridYs = [0, 25, 50, 75, 100].map(v => ({ v, y: padT + innerH * (1 - v/100) }));
    const dots = points.map((p, i) => {
      const cls = p.pct >= 80 ? "good" : p.pct >= 50 ? "mid" : "low";
      return `<circle class="chart-dot ${cls}" cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3"><title>${p.key}: ${p.pct}%</title></circle>`;
    }).join("");
    const xLabels = points.map((p, i) => {
      if (points.length <= 7 || i % Math.ceil(points.length / 7) === 0 || i === points.length - 1) {
        return `<text class="chart-tick" x="${xs[i].toFixed(1)}" y="${H - 8}" text-anchor="middle">${p.date.getMonth()+1}/${p.date.getDate()}</text>`;
      }
      return "";
    }).join("");
    const gridLines = gridYs.map(g =>
      `<line class="chart-grid" x1="${padL}" x2="${W-padR}" y1="${g.y}" y2="${g.y}"/>
       <text class="chart-tick" x="${padL-6}" y="${g.y+3}" text-anchor="end">${g.v}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily effectiveness line chart">
      ${gridLines}
      <line class="chart-goal" x1="${padL}" x2="${W-padR}" y1="${goalY}" y2="${goalY}"/>
      <text class="chart-tick" x="${W-padR}" y="${goalY-3}" text-anchor="end">80% goal</text>
      <path class="chart-line" d="${path}"/>
      ${dots}
      ${xLabels}
    </svg>`;
  }

  function renderWeeklyBars(series) {
    if (!series.length) return `<p class="muted small">No logged days yet.</p>`;
    // Group last 12 ISO-ish weeks (Mon-Sun).
    const byWeek = new Map();
    for (const s of series) {
      const d = new Date(s.date);
      const day = (d.getDay() + 6) % 7; // 0=Mon
      const monday = addDays(d, -day);
      const wk = fmtDateKey(monday);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk).push(s.pct);
    }
    const weeks = [...byWeek.entries()].sort().slice(-12);
    if (!weeks.length) return `<p class="muted small">Not enough data yet.</p>`;
    const W = 680, H = 160, padL = 30, padR = 10, padT = 10, padB = 28;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const barW = Math.min(40, (innerW - 8 * weeks.length) / weeks.length);
    const goalY = padT + innerH * (1 - 0.8);
    const bars = weeks.map(([wk, pcts], i) => {
      const avg = Math.round(pcts.reduce((a,b)=>a+b,0) / pcts.length);
      const x = padL + i * (innerW / weeks.length) + (innerW / weeks.length - barW) / 2;
      const y = padT + innerH * (1 - avg / 100);
      const h = innerH - (y - padT);
      const cls = avg >= 80 ? "good" : avg >= 50 ? "mid" : "low";
      const d = parseDateKey(wk);
      const lbl = `${d.getMonth()+1}/${d.getDate()}`;
      return `<rect class="chart-bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2,h).toFixed(1)}" rx="3"><title>Week of ${wk}: ${avg}%</title></rect>
              <text class="chart-tick" x="${(x + barW/2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${lbl}</text>
              <text class="chart-tick" x="${(x + barW/2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${avg}</text>`;
    }).join("");
    const gridYs = [0, 25, 50, 75, 100].map(v => padT + innerH * (1 - v/100));
    const grid = gridYs.map((y, i) =>
      `<line class="chart-grid" x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}"/>
       <text class="chart-tick" x="${padL-6}" y="${y+3}" text-anchor="end">${[0,25,50,75,100][i]}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly effectiveness bars">
      ${grid}
      <line class="chart-goal" x1="${padL}" x2="${W-padR}" y1="${goalY}" y2="${goalY}"/>
      ${bars}
    </svg>`;
  }

  function renderHeatmap(series) {
    if (!series.length) return `<p class="muted small">No logged days yet.</p>`;
    const today = new Date();
    const todayDay = (today.getDay() + 6) % 7; // 0=Mon
    const startCol = 11; // 12 columns
    const start = addDays(today, -(todayDay) - 7 * startCol);
    const map = new Map(series.map(s => [s.key, s.pct]));
    const cell = 14, gap = 3, W = 12 * (cell + gap) + 30, H = 7 * (cell + gap) + 22;
    const rows = ["M","T","W","T","F","S","S"];
    let cells = "";
    for (let c = 0; c < 12; c++) {
      for (let r = 0; r < 7; r++) {
        const d = addDays(start, c * 7 + r);
        if (d > today) continue;
        const k = fmtDateKey(d);
        const pct = map.get(k);
        let cls = "empty";
        if (pct != null) {
          if (pct >= 80) cls = "l4";
          else if (pct >= 60) cls = "l3";
          else if (pct >= 30) cls = "l2";
          else cls = "l1";
        }
        const x = 22 + c * (cell + gap);
        const y = 2 + r * (cell + gap);
        cells += `<rect class="heat-cell ${cls}" x="${x}" y="${y}" width="${cell}" height="${cell}"><title>${k}${pct != null ? ": " + pct + "%" : ""}</title></rect>`;
      }
    }
    const rowLabels = rows.map((r, i) =>
      `<text class="chart-tick" x="16" y="${2 + i * (cell + gap) + cell - 3}" text-anchor="end">${r}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Effectiveness heatmap">
      ${rowLabels}
      ${cells}
    </svg>`;
  }

  // ============================================================
  // Timer (floating pill + per-slot trigger)
  // ============================================================
  const timer = {
    state: "idle",       // 'idle' | 'running' | 'paused' | 'done'
    duration: 15 * 60,   // seconds
    remaining: 15 * 60,
    slot: null,          // slot key being timed, or null
    intervalId: null,
    endsAt: null
  };
  let audioCtx = null;

  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
  }

  const BASE_TITLE = document.title;
  function renderTimer() {
    $("#tp-time").textContent = fmtClock(timer.remaining);
    $("#tp-label").textContent = timer.slot
      ? `Slot ${timer.slot}${timer.state === "done" ? " · done!" : ""}`
      : `${Math.round(timer.duration/60)}-min timer`;
    $("#timer-pill").dataset.state = timer.state;
    $("#tp-pause").hidden = timer.state !== "running";
    $("#tp-start").hidden = timer.state === "running";
    $("#tp-duration").value = String(timer.duration / 60);
    document.title = timer.state === "running"
      ? `⏱ ${fmtClock(timer.remaining)} · BEE`
      : timer.state === "done"
        ? `🔔 Done · BEE`
        : BASE_TITLE;
  }

  function timerStart(durationSec = timer.duration, slot = timer.slot) {
    timer.duration = durationSec;
    if (timer.state !== "paused" || timer.slot !== slot) timer.remaining = durationSec;
    timer.slot = slot;
    timer.state = "running";
    timer.endsAt = Date.now() + timer.remaining * 1000;
    if (timer.intervalId) clearInterval(timer.intervalId);
    timer.intervalId = setInterval(timerTick, 250);
    renderTimer();
    renderSlots();
  }
  function timerPause() {
    if (timer.state !== "running") return;
    timer.remaining = Math.max(0, (timer.endsAt - Date.now()) / 1000);
    timer.state = "paused";
    clearInterval(timer.intervalId); timer.intervalId = null;
    renderTimer();
  }
  function timerReset() {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
    timer.state = "idle";
    timer.slot = null;
    timer.remaining = timer.duration;
    renderTimer();
    renderSlots();
  }
  function timerTick() {
    const left = Math.max(0, (timer.endsAt - Date.now()) / 1000);
    timer.remaining = left;
    if (left <= 0) timerComplete();
    else renderTimer();
  }
  function timerComplete() {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
    timer.state = "done";
    timer.remaining = 0;
    renderTimer();
    ringBell();
    if (timer.slot) {
      // Offer to mark the slot as done.
      setTimeout(() => {
        if (confirm(`Timer done for ${timer.slot}. Mark this slot as ✓ followed?`)) {
          const d = dayFor(currentDateKey);
          d.actuals[timer.slot] = { status: "done" };
          saveState();
          schedulePush(currentDateKey);
        }
        renderSlots();
      }, 50);
    }
  }
  function timerStartForSlot(slot) {
    if (timer.state === "running" && timer.slot === slot) {
      // Toggle off
      timerReset();
      return;
    }
    // Default to 15 min when targeting a slot.
    timerStart(15 * 60, slot);
  }
  function wireTimer() {
    $("#tp-start").addEventListener("click", () => {
      ensureAudio();
      timerStart(parseInt($("#tp-duration").value, 10) * 60, timer.slot);
    });
    $("#tp-pause").addEventListener("click", timerPause);
    $("#tp-reset").addEventListener("click", timerReset);
    $("#tp-duration").addEventListener("change", () => {
      const sec = parseInt($("#tp-duration").value, 10) * 60;
      timer.duration = sec;
      if (timer.state !== "running") timer.remaining = sec;
      renderTimer();
    });
    renderTimer();
  }

  // ============================================================
  // Audio bell
  // ============================================================
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { audioCtx = null; }
  }
  function ringBell() {
    ensureAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const tones = [
      { freq: 1318, start: 0.00, dur: 1.4 },
      { freq:  988, start: 0.18, dur: 1.2 },
      { freq: 1568, start: 0.36, dur: 1.0 }
    ];
    for (const { freq, start, dur } of tones) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = "sine"; o.frequency.value = freq;
      const t = audioCtx.currentTime + start;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // ============================================================
  // Export
  // ============================================================
  function dayToRows(key, d) {
    const rows = [];
    for (const slot of SLOTS) {
      const plan = d.plans[slot] || "";
      const a = d.actuals[slot];
      if (!plan && !a) continue;
      rows.push({ date: key, slot, plan, status: a?.status || "", note: a?.note || "" });
    }
    return rows;
  }
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function csv(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function exportCSV() {
    const header = ["date","day","slot","plan","status","note","points","planned","pct"];
    const lines = [header.join(",")];
    for (const k of Object.keys(state.days).sort()) {
      const d = state.days[k]; const s = statsFor(d);
      const rows = dayToRows(k, d); if (!rows.length) continue;
      const dayName = DOW[parseDateKey(k).getDay()];
      for (const r of rows) {
        lines.push([r.date, dayName, r.slot, csv(r.plan), r.status, csv(r.note),
                    r.status === "done" ? 1 : 0, s.planned, s.pct].join(","));
      }
    }
    download(`bee-log-${todayKey()}.csv`, lines.join("\n"), "text/csv");
  }
  function exportJSON() {
    download(`bee-log-${todayKey()}.json`, JSON.stringify(state, null, 2), "application/json");
  }
  function copyTodayAsText() {
    const d = dayFor(currentDateKey); const s = statsFor(d);
    const date = parseDateKey(currentDateKey);
    const lines = [`${DOW[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
                   `Effectiveness: ${s.pct}% (${s.done}/${s.planned})`, ""];
    for (const slot of SLOTS) {
      const plan = d.plans[slot]; const a = d.actuals[slot];
      if (!plan && !a) continue;
      let line = `${slot}  ${plan || "(no plan)"}`;
      if (a?.status === "done") line += "  ✓";
      else if (a?.status === "missed") line += `  ✗  actual: ${a.note || "—"}`;
      lines.push(line);
    }
    const text = lines.join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => flash("Copied to clipboard."))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); flash("Copied."); }
        catch { alert(text); }
        ta.remove();
      });
  }

  // Lightweight flash on the cloud-status line.
  let flashTimer;
  function flash(msg, where = "#cloud-status") {
    const el = $(where);
    if (!el) return;
    const prev = el.innerHTML;
    el.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.innerHTML = prev; renderCloudStatus(); }, 2200);
  }

  // ============================================================
  // Supabase: cloud config, auth, sync
  // ============================================================
  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    const { url, anonKey } = state.supabase || {};
    if (!url || !anonKey || !window.supabase) return null;
    supabaseClient = window.supabase.createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "bee.sb-auth"
      }
    });
    return supabaseClient;
  }

  function renderCloudStatus() {
    const el = $("#cloud-status");
    const footer = $("#footer-account");
    const hasConfig = !!(state.supabase?.url && state.supabase?.anonKey);
    const signedIn = !!session?.user;
    $("#signin-btn").hidden = !hasConfig || signedIn;
    $("#signout-btn").hidden = !signedIn;
    $("#sync-now-btn").hidden = !signedIn;
    if (!hasConfig) {
      el.innerHTML = `<span class="cloud-status-dot"></span>Local only — cloud not configured.`;
      footer.textContent = "local only";
      return;
    }
    if (!signedIn) {
      el.innerHTML = `<span class="cloud-status-dot pending"></span>Cloud configured — not signed in.`;
      footer.textContent = "not signed in";
      return;
    }
    el.innerHTML = `<span class="cloud-status-dot ok"></span>Signed in as <strong>${escapeHtml(session.user.email || "(anon)")}</strong>.`;
    footer.textContent = session.user.email || "signed in";
  }

  // Push queue: per-day, debounced ~1s.
  const pushQueue = new Map(); // date -> timeoutId
  function schedulePush(dateKey) {
    if (!session?.user) return;
    if (pushQueue.has(dateKey)) clearTimeout(pushQueue.get(dateKey));
    pushQueue.set(dateKey, setTimeout(() => { pushQueue.delete(dateKey); pushDay(dateKey); }, 1000));
  }
  async function pushDay(dateKey) {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    const d = state.days[dateKey] || { plans: {}, actuals: {} };
    try {
      const { error } = await sb.from("bee_days").upsert({
        user_id: session.user.id,
        date: dateKey,
        plans: d.plans,
        actuals: d.actuals
      }, { onConflict: "user_id,date" });
      if (error) throw error;
    } catch (e) {
      console.warn("pushDay failed", e);
      flash("Sync error — will retry on next change.");
    }
  }
  async function pullDay(dateKey) {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    try {
      const { data, error } = await sb.from("bee_days")
        .select("plans,actuals,updated_at")
        .eq("user_id", session.user.id)
        .eq("date", dateKey)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        state.days[dateKey] = { plans: data.plans || {}, actuals: data.actuals || {} };
        saveState();
      }
    } catch (e) {
      console.warn("pullDay failed", e);
    }
  }
  async function pullAll() {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    try {
      const { data, error } = await sb.from("bee_days")
        .select("date,plans,actuals,updated_at")
        .eq("user_id", session.user.id);
      if (error) throw error;
      for (const row of data || []) {
        state.days[row.date] = { plans: row.plans || {}, actuals: row.actuals || {} };
      }
      saveState();
      flash("Pulled latest from cloud.");
      renderAll();
    } catch (e) {
      console.warn("pullAll failed", e);
      flash("Cloud pull failed.");
    }
  }
  async function pushAll() {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    const rows = Object.keys(state.days).map(date => ({
      user_id: session.user.id, date,
      plans: state.days[date].plans || {},
      actuals: state.days[date].actuals || {}
    }));
    if (!rows.length) return;
    try {
      const { error } = await sb.from("bee_days").upsert(rows, { onConflict: "user_id,date" });
      if (error) throw error;
      flash("Pushed local data to cloud.");
    } catch (e) {
      console.warn("pushAll failed", e);
      flash("Cloud push failed.");
    }
  }
  async function fullSync() {
    await pullAll();
    await pullBoard();
    await pushAll();
    await pushBoard();
  }

  // ============================================================
  // Board (Trello-style task lists)
  // ============================================================
  const DEFAULT_LISTS = [
    { id: "today", name: "Today" },
    { id: "inbox", name: "Inbox" },
    { id: "week",  name: "This week" },
    { id: "done",  name: "Done" }
  ];
  let cardEditing = null; // id of card open in edit modal, or null

  function newId() { return Math.random().toString(36).slice(2, 10); }

  function ensureBoard() {
    if (!state.board || typeof state.board !== "object") {
      state.board = { lists: DEFAULT_LISTS.map(l => ({ ...l })), cards: [] };
    }
    if (!Array.isArray(state.board.lists) || !state.board.lists.length) {
      state.board.lists = DEFAULT_LISTS.map(l => ({ ...l }));
    }
    if (!state.board.lists.some(l => l.id === "today")) {
      state.board.lists.unshift({ id: "today", name: "Today" });
    }
    if (!Array.isArray(state.board.cards)) state.board.cards = [];
  }

  function addCard(listId, title) {
    ensureBoard();
    state.board.cards.push({
      id: newId(),
      listId,
      title: title.trim(),
      note: "",
      createdAt: new Date().toISOString(),
      completedAt: null
    });
    saveState();
    scheduleBoardPush();
  }
  function moveCard(cardId, toListId) {
    const c = state.board.cards.find(x => x.id === cardId);
    if (!c) return;
    c.listId = toListId;
    c.completedAt = toListId === "done" ? new Date().toISOString() : null;
    saveState();
    scheduleBoardPush();
  }
  function deleteCard(cardId) {
    state.board.cards = state.board.cards.filter(c => c.id !== cardId);
    saveState();
    scheduleBoardPush();
  }
  function updateCard(cardId, patch) {
    const c = state.board.cards.find(x => x.id === cardId);
    if (!c) return;
    Object.assign(c, patch);
    saveState();
    scheduleBoardPush();
  }
  function addList(name) {
    ensureBoard();
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    state.board.lists.push({ id: newId(), name: trimmed });
    saveState();
    scheduleBoardPush();
  }
  function renameList(listId, name) {
    const l = state.board.lists.find(x => x.id === listId);
    if (!l) return;
    l.name = name.trim() || l.name;
    saveState();
    scheduleBoardPush();
  }
  function deleteList(listId) {
    if (["today", "done"].includes(listId)) return; // protect core lists
    // Move any cards on this list back to Inbox (or create one if missing).
    if (!state.board.lists.some(l => l.id === "inbox")) {
      state.board.lists.push({ id: "inbox", name: "Inbox" });
    }
    for (const c of state.board.cards) if (c.listId === listId) c.listId = "inbox";
    state.board.lists = state.board.lists.filter(l => l.id !== listId);
    saveState();
    scheduleBoardPush();
  }

  function openBoard() {
    if (location.hash !== "#/board") location.hash = "#/board";
    else applyRoute();
  }

  // Hash-based routing. The board lives at #/board so it's a real page
  // with a working back button; everything else is the day view.
  function applyRoute() {
    const onBoard = location.hash === "#/board" || location.hash === "#board";
    $("#day-view").hidden = onBoard;
    $("#board-view").hidden = !onBoard;
    if (onBoard) {
      ensureBoard();
      renderBoard();
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }
  }
  function wireRouter() {
    window.addEventListener("hashchange", applyRoute);
    $("#board-back").addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.hash = "";
    });
  }

  function renderBoard() {
    ensureBoard();
    const body = $("#board-body");
    body.innerHTML = "";
    for (const list of state.board.lists) {
      body.appendChild(renderBoardList(list));
    }
    attachBoardSortables();
  }

  // Attach drag-and-drop to every list's card column. Cards can move
  // between lists (group "cards"). On touch we add a small delay so a
  // plain tap still opens the card editor.
  let boardSortables = [];
  function attachBoardSortables() {
    for (const s of boardSortables) { try { s.destroy(); } catch {} }
    boardSortables = [];
    if (!window.Sortable) return;
    for (const col of $$(".board-cards")) {
      boardSortables.push(window.Sortable.create(col, {
        group: "bee-cards",
        animation: 160,
        delay: 180,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        ghostClass: "card-ghost",
        chosenClass: "card-chosen",
        dragClass: "card-dragging",
        onAdd: captureBoardOrder,
        onUpdate: captureBoardOrder,
        onEnd: () => { /* visual cleanup handled by class swap */ }
      }));
    }
  }

  // After any drag, walk the DOM in display order and rebuild
  // state.board.cards so listId + sequence match what the user sees.
  function captureBoardOrder() {
    const next = [];
    for (const listEl of $$(".board-list")) {
      const listId = listEl.dataset.listId;
      for (const cardEl of listEl.querySelectorAll(".board-card")) {
        const id = cardEl.dataset.cardId;
        const card = state.board.cards.find(c => c.id === id);
        if (!card) continue;
        card.listId = listId;
        card.completedAt = listId === "done"
          ? (card.completedAt || new Date().toISOString())
          : null;
        next.push(card);
      }
    }
    state.board.cards = next;
    saveState();
    scheduleBoardPush();
    renderBoard();
  }

  function renderBoardList(list) {
    const section = document.createElement("section");
    section.className = "board-list";
    if (list.id === "today") section.classList.add("is-today");
    if (list.id === "done")  section.classList.add("is-done");
    section.dataset.listId = list.id;

    const cards = state.board.cards.filter(c => c.listId === list.id);

    const head = document.createElement("div");
    head.className = "board-list-head";
    const h = document.createElement("h4");
    const name = document.createElement("input");
    name.className = "list-name";
    name.type = "text";
    name.value = list.name;
    name.readOnly = ["today", "inbox", "week", "done"].includes(list.id);
    name.addEventListener("change", () => renameList(list.id, name.value));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });
    h.appendChild(name);
    const count = document.createElement("small");
    count.textContent = String(cards.length);
    h.appendChild(count);
    head.appendChild(h);

    if (!["today", "done"].includes(list.id)) {
      const menuBtn = document.createElement("button");
      menuBtn.className = "list-menu-btn ghost";
      menuBtn.type = "button";
      menuBtn.title = "Remove list";
      menuBtn.textContent = "🗑";
      menuBtn.addEventListener("click", () => {
        if (confirm(`Remove list "${list.name}"? Cards move to Inbox.`)) {
          deleteList(list.id);
          renderBoard();
        }
      });
      head.appendChild(menuBtn);
    }
    section.appendChild(head);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "board-cards";
    for (const c of cards) cardsWrap.appendChild(renderCard(c, list.id));
    section.appendChild(cardsWrap);

    const form = document.createElement("form");
    form.className = "board-add";
    form.innerHTML = `<input type="text" placeholder="Add a card…" />`;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      const v = input.value.trim();
      if (!v) return;
      addCard(list.id, v);
      input.value = "";
      renderBoard();
    });
    section.appendChild(form);
    return section;
  }

  function renderCard(c, listId) {
    const art = document.createElement("article");
    art.className = "board-card";
    if (listId === "done") art.classList.add("is-done");
    art.dataset.cardId = c.id;

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = c.title;
    body.appendChild(title);
    if (c.note) {
      const note = document.createElement("div");
      note.className = "card-note";
      note.textContent = c.note;
      body.appendChild(note);
    }
    art.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    if (listId !== "today") {
      const todayBtn = document.createElement("button");
      todayBtn.type = "button";
      todayBtn.className = "card-action today";
      todayBtn.title = "Move to Today";
      todayBtn.textContent = "★";
      todayBtn.addEventListener("click", (e) => { e.stopPropagation(); moveCard(c.id, "today"); renderBoard(); });
      actions.appendChild(todayBtn);
    }
    if (listId !== "done") {
      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "card-action done-btn";
      doneBtn.title = "Mark done";
      doneBtn.textContent = "✓";
      doneBtn.addEventListener("click", (e) => { e.stopPropagation(); moveCard(c.id, "done"); renderBoard(); });
      actions.appendChild(doneBtn);
    }

    art.appendChild(actions);
    art.addEventListener("click", () => openCardEdit(c.id));
    return art;
  }

  function openCardEdit(cardId) {
    ensureBoard();
    const c = state.board.cards.find(x => x.id === cardId);
    if (!c) return;
    cardEditing = cardId;
    $("#card-title-input").value = c.title || "";
    $("#card-note-input").value = c.note || "";
    const sel = $("#card-list-input");
    sel.innerHTML = state.board.lists.map(l => `<option value="${l.id}" ${l.id === c.listId ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
    $("#card-modal").showModal();
    setTimeout(() => $("#card-title-input").focus(), 20);
  }
  function wireCardModal() {
    $("#card-save").addEventListener("click", () => {
      if (!cardEditing) return;
      const title = $("#card-title-input").value.trim();
      const note = $("#card-note-input").value.trim();
      const listId = $("#card-list-input").value;
      if (!title) { alert("Title is required."); return; }
      updateCard(cardEditing, { title, note, listId });
      cardEditing = null;
      $("#card-modal").close();
      renderBoard();
    });
    $("#card-today").addEventListener("click", () => {
      if (!cardEditing) return;
      moveCard(cardEditing, "today");
      cardEditing = null;
      $("#card-modal").close();
      renderBoard();
    });
    $("#card-delete").addEventListener("click", () => {
      if (!cardEditing) return;
      if (!confirm("Delete this card?")) return;
      deleteCard(cardEditing);
      cardEditing = null;
      $("#card-modal").close();
      renderBoard();
    });
  }

  // Sync
  let boardPushTimer = null;
  function scheduleBoardPush() {
    if (!session?.user) return;
    if (boardPushTimer) clearTimeout(boardPushTimer);
    boardPushTimer = setTimeout(pushBoard, 1000);
  }
  async function pushBoard() {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    ensureBoard();
    try {
      const { error } = await sb.from("bee_board").upsert({
        user_id: session.user.id,
        payload: state.board
      }, { onConflict: "user_id" });
      if (error) throw error;
    } catch (e) {
      console.warn("pushBoard failed", e);
    }
  }
  async function pullBoard() {
    const sb = getSupabase();
    if (!sb || !session?.user) return;
    try {
      const { data, error } = await sb.from("bee_board")
        .select("payload")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (data?.payload) {
        state.board = data.payload;
        ensureBoard();
        saveState();
      }
    } catch (e) {
      console.warn("pullBoard failed", e);
    }
  }

  // Auth
  async function initAuth() {
    const sb = getSupabase();
    if (!sb) { refreshAuthGate(); return; }
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session || null;
    } catch (e) {
      console.warn("getSession failed", e);
      session = null;
    }
    sb.auth.onAuthStateChange((_event, s) => {
      session = s;
      renderCloudStatus();
      refreshAuthGate();
      if (s?.user) fullSync();
    });
    renderCloudStatus();
    refreshAuthGate();
    if (session?.user) fullSync();
  }
  async function sendMagicLink() {
    const sb = getSupabase();
    if (!sb) { authFeedback("Configure Supabase first.", true); return; }
    const email = $("#auth-email").value.trim();
    if (!email) { authFeedback("Enter your email.", true); return; }
    authFeedback("Sending magic link…");
    try {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
      if (error) throw error;
      authFeedback("Check your email for a magic link.");
    } catch (e) {
      authFeedback(`Failed: ${e.message || e}`, true);
    }
  }
  async function signOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    session = null;
    renderCloudStatus();
  }

  // Cloud setup modal
  function openCloudModal() {
    $("#supabase-url").value = state.supabase?.url || "";
    $("#supabase-key").value = state.supabase?.anonKey || "";
    $("#cloud-feedback").textContent = "";
    $("#cloud-modal").showModal();
  }
  function wireCloudModal() {
    $("#cloud-setup-btn").addEventListener("click", openCloudModal);
    $("#save-cloud").addEventListener("click", () => {
      const url = $("#supabase-url").value.trim();
      const key = $("#supabase-key").value.trim();
      state.supabase = url && key ? { url, anonKey: key } : {};
      saveState();
      supabaseClient = null; // force re-init
      $("#cloud-feedback").textContent = url && key ? "Saved. Now sign in." : "Cleared.";
      initAuth();
    });
    $("#test-cloud").addEventListener("click", async () => {
      const url = $("#supabase-url").value.trim();
      const key = $("#supabase-key").value.trim();
      if (!url || !key) { $("#cloud-feedback").textContent = "Enter URL + anon key."; return; }
      $("#cloud-feedback").textContent = "Testing…";
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: key } });
        $("#cloud-feedback").textContent = res.ok ? "OK — project reachable." : `HTTP ${res.status}`;
      } catch (e) {
        $("#cloud-feedback").textContent = `Failed: ${e.message || e}`;
      }
    });
    $("#clear-cloud").addEventListener("click", () => {
      state.supabase = {};
      saveState();
      supabaseClient = null;
      session = null;
      localStorage.removeItem(USE_LOCAL_KEY);
      $("#supabase-url").value = "";
      $("#supabase-key").value = "";
      $("#cloud-feedback").textContent = "Disconnected.";
      renderCloudStatus();
      refreshAuthGate();
    });
  }
  // ============================================================
  // Auth view (full-page login)
  // ============================================================
  // localStorage["bee.useLocal"] = "1" means user picked "Use locally"
  // and we suppress the auth view even if Supabase is configured until
  // they click "Sign in" again from the cloud card.
  const USE_LOCAL_KEY = "bee.useLocal";
  let authMode = "signin"; // 'signin' | 'signup'

  function authFeedback(msg, isError = false) {
    const el = $("#auth-feedback");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "var(--red)" : "var(--muted)";
  }
  function showAuthView() {
    authFeedback("");
    $("#auth-view").hidden = false;
    $("#app-view").hidden = true;
    setTimeout(() => $("#auth-email")?.focus(), 30);
  }
  function showAppView() {
    $("#auth-view").hidden = true;
    $("#app-view").hidden = false;
  }
  function shouldGate() {
    const cloudConfigured = !!(state.supabase?.url && state.supabase?.anonKey);
    if (!cloudConfigured) return false;
    if (session?.user) return false;
    if (localStorage.getItem(USE_LOCAL_KEY) === "1") return false;
    return true;
  }
  function refreshAuthGate() {
    if (shouldGate()) showAuthView();
    else showAppView();
  }
  function setAuthMode(mode) {
    authMode = mode;
    $$(".auth-tab").forEach(t => {
      const active = t.dataset.mode === mode;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    const submit = $("#auth-submit");
    submit.textContent = mode === "signup" ? "Create account" : "Sign in";
    const pwd = $("#auth-password");
    pwd.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
    pwd.minLength = mode === "signup" ? 6 : 6;
    authFeedback("");
  }
  async function authSubmit(e) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) { authFeedback("Configure Supabase first.", true); return; }
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    if (!email || !password) { authFeedback("Enter email and password.", true); return; }
    $("#auth-submit").disabled = true;
    authFeedback(authMode === "signup" ? "Creating account…" : "Signing in…");
    try {
      const fn = authMode === "signup" ? "signUp" : "signInWithPassword";
      const { data, error } = await sb.auth[fn]({ email, password });
      if (error) throw error;
      if (authMode === "signup" && !data?.session) {
        authFeedback("Account created. Check your email to confirm, then sign in.");
        setAuthMode("signin");
      } else if (data?.session) {
        session = data.session;
        renderCloudStatus();
        refreshAuthGate();
        fullSync();
      }
    } catch (err) {
      authFeedback(`Failed: ${err.message || err}`, true);
    } finally {
      $("#auth-submit").disabled = false;
    }
  }
  function wireAuthView() {
    $$(".auth-tab").forEach(t => t.addEventListener("click", () => setAuthMode(t.dataset.mode)));
    $("#auth-form").addEventListener("submit", authSubmit);
    $("#auth-magic").addEventListener("click", sendMagicLink);
    $("#auth-config").addEventListener("click", openCloudModal);
    $("#auth-use-local").addEventListener("click", () => {
      localStorage.setItem(USE_LOCAL_KEY, "1");
      showAppView();
    });

    // Buttons inside the app's cloud card
    $("#signin-btn").addEventListener("click", () => {
      localStorage.removeItem(USE_LOCAL_KEY);
      if (!getSupabase()) { openCloudModal(); return; }
      showAuthView();
    });
    $("#signout-btn").addEventListener("click", async () => {
      await signOut();
      refreshAuthGate();
    });
    $("#sync-now-btn").addEventListener("click", fullSync);
  }

  // ============================================================
  // Google Sheets (legacy)
  // ============================================================
  function renderSheetsStatus() {
    const el = $("#sheets-status");
    if (!el) return;
    el.textContent = state.sheets?.url ? "Google Sheet connected." : "Google Sheet not configured.";
  }
  function openSheetsModal() {
    const modal = $("#sheets-modal");
    $("#sheets-url").value = state.sheets?.url || "";
    $("#sheets-secret").value = state.sheets?.secret || "";
    $("#sheets-feedback").textContent = "";
    modal.showModal();
  }
  async function pushToSheets() {
    const url = state.sheets?.url;
    if (!url) { openSheetsModal(); return; }
    const d = dayFor(currentDateKey); const s = statsFor(d);
    const date = parseDateKey(currentDateKey);
    const payload = {
      secret: state.sheets.secret || "",
      date: currentDateKey, day: DOW[date.getDay()],
      points: s.done, planned: s.planned, missed: s.missed, pct: s.pct,
      rows: dayToRows(currentDateKey, d)
    };
    flash("Pushing to Google Sheet…", "#sheets-status");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      flash("Pushed to Sheet ✓", "#sheets-status");
    } catch (e) {
      console.warn(e);
      flash("Sheet push failed.", "#sheets-status");
    }
  }
  function wireSheetsModal() {
    $("#save-sheets").addEventListener("click", () => {
      const url = $("#sheets-url").value.trim();
      const secret = $("#sheets-secret").value.trim();
      state.sheets = url ? { url, secret } : {};
      saveState();
      $("#sheets-feedback").textContent = "Saved.";
      renderSheetsStatus();
    });
    $("#test-sheets").addEventListener("click", async () => {
      const url = $("#sheets-url").value.trim();
      if (!url) { $("#sheets-feedback").textContent = "Enter a URL first."; return; }
      $("#sheets-feedback").textContent = "Testing…";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ test: true, secret: $("#sheets-secret").value.trim() })
        });
        $("#sheets-feedback").textContent = res.ok ? "OK." : `HTTP ${res.status}`;
      } catch {
        $("#sheets-feedback").textContent = "Failed.";
      }
    });
    $("#clear-sheets").addEventListener("click", () => {
      state.sheets = {};
      saveState();
      $("#sheets-url").value = ""; $("#sheets-secret").value = "";
      $("#sheets-feedback").textContent = "Cleared.";
      renderSheetsStatus();
    });
  }

  // ============================================================
  // Buttons & boot
  // ============================================================
  function wireButtons() {
    $("#history-btn").addEventListener("click", openHistory);
    $("#trends-btn").addEventListener("click", openTrends);
    $("#board-btn").addEventListener("click", openBoard);
    $("#board-add-list-btn").addEventListener("click", () => {
      const name = prompt("New list name:");
      if (name) { addList(name); renderBoard(); }
    });
    $("#export-csv").addEventListener("click", exportCSV);
    $("#export-json").addEventListener("click", exportJSON);
    $("#copy-text").addEventListener("click", copyTodayAsText);
    $("#push-sheets").addEventListener("click", pushToSheets);
    $("#configure-sheets").addEventListener("click", openSheetsModal);
  }

  function renderAll() {
    renderHeader();
    renderQuote();
    renderSlots();
    renderSheetsStatus();
    renderCloudStatus();
  }

  // One-tap auto-config: parse `#cloud=<url>|<key>` from the URL hash on
  // first load, save it as the Supabase config, and strip it back out of
  // the address bar so it doesn't sit in history forever.
  function consumeCloudConfigFromUrl() {
    if (!location.hash) return;
    const m = location.hash.match(/[#&]cloud=([^&]+)/);
    if (!m) return;
    try {
      const decoded = decodeURIComponent(m[1]);
      const sep = decoded.indexOf("|");
      const url = sep === -1 ? decoded : decoded.slice(0, sep);
      const key = sep === -1 ? "" : decoded.slice(sep + 1);
      if (url && key) {
        state.supabase = { url, anonKey: key };
        localStorage.removeItem(USE_LOCAL_KEY);
        saveState();
      }
    } catch (e) {
      console.warn("bad #cloud=", e);
    }
    const cleaned = location.hash.replace(/[#&]cloud=[^&]+/, "");
    history.replaceState(null, "", location.pathname + location.search + (cleaned === "#" ? "" : cleaned));
  }

  applyTheme(loadTheme());

  document.addEventListener("DOMContentLoaded", () => {
    consumeCloudConfigFromUrl();
    migrate30to15();
    wireThemeToggle();
    wireGroupToggles();
    wireNav();
    wireButtons();
    wireSheetsModal();
    wireCloudModal();
    wireAuthView();
    setAuthMode("signin");
    wireCardModal();
    ensureBoard();
    wireRouter();
    wireTimer();
    renderAll();
    applyRoute();
    maybeShowPlanTomorrow();
    initAuth();
    // Refresh the "now" indicator each minute.
    setInterval(() => { if (currentDateKey === todayKey()) renderSlots(); }, 60_000);
  });
})();

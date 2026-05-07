/* BEE — Becoming Effective Executives
   All data lives in localStorage under the key STORAGE_KEY.
   Structure:
     {
       version: 1,
       days: {
         "YYYY-MM-DD": {
           plans:   { "HH:MM": "plan text" },
           actuals: { "HH:MM": { status: "done" | "missed", note?: string } }
         }
       },
       sheets: { url: string, secret?: string }
     }
*/

(() => {
  "use strict";

  const STORAGE_KEY = "bee.v1";
  const DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // --------- Helpers ---------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const fmtDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const parseDateKey = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
  };
  const todayKey = () => fmtDateKey(new Date());

  const pad2 = (n) => String(n).padStart(2, "0");

  // --------- State ---------
  let state = loadState();
  let currentDateKey = todayKey();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, days: {}, sheets: {} };
      const parsed = JSON.parse(raw);
      if (!parsed.days) parsed.days = {};
      if (!parsed.sheets) parsed.sheets = {};
      return parsed;
    } catch {
      return { version: 1, days: {}, sheets: {} };
    }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("save failed", e);
    }
  }
  function dayFor(key) {
    if (!state.days[key]) state.days[key] = { plans: {}, actuals: {} };
    return state.days[key];
  }

  // --------- Time slots ---------
  // 48 slots: 00:00, 00:30, 01:00 ... 23:30
  const SLOTS = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      SLOTS.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  const groupFor = (slot) => {
    const h = parseInt(slot.slice(0, 2), 10);
    if (h < 6) return "early";
    if (h >= 22) return "late";
    return "day";
  };

  // --------- Header & quote ---------
  function renderHeader() {
    const d = parseDateKey(currentDateKey);
    $("#dow").textContent = DOW[d.getDay()];
    $("#dmy").textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function renderQuote() {
    const qs = window.DRUCKER_QUOTES || [];
    if (!qs.length) return;
    // Deterministic pick based on date so the quote is stable for the day.
    const d = parseDateKey(currentDateKey);
    const idx = (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()) % qs.length;
    const q = qs[idx];
    $("#quote").textContent = `“${q.text}”`;
    $("#quote-source").textContent = `— Peter F. Drucker · ${q.source}`;
  }

  // --------- Slot rendering ---------
  function renderSlots() {
    const dayData = dayFor(currentDateKey);
    ["early", "day", "late"].forEach((g) => {
      const body = $(`[data-group-body="${g}"]`);
      body.innerHTML = "";
      SLOTS.filter((s) => groupFor(s) === g).forEach((slot) => {
        body.appendChild(buildSlotRow(slot, dayData));
      });
    });
    updateGroupMeta();
    updateScore();
  }

  function buildSlotRow(slot, dayData) {
    const row = document.createElement("div");
    row.className = "slot";
    if (slot.endsWith(":00")) row.classList.add("hour-mark");
    row.dataset.slot = slot;

    const actual = dayData.actuals[slot];
    if (actual?.status === "done") row.classList.add("done");
    if (actual?.status === "missed") row.classList.add("missed");

    // Time cell
    const time = document.createElement("div");
    time.className = "slot-time";
    const [h, m] = slot.split(":").map(Number);
    const label12 = `${((h + 11) % 12) + 1}:${pad2(m)}${h < 12 ? "am" : "pm"}`;
    time.innerHTML = `${slot}<small>${label12}</small>`;
    row.appendChild(time);

    // Main cell (plan + actual)
    const main = document.createElement("div");
    main.className = "slot-main";

    const plan = document.createElement("input");
    plan.type = "text";
    plan.className = "slot-plan";
    plan.placeholder = "Plan this block…";
    plan.value = dayData.plans[slot] || "";
    plan.addEventListener("input", () => {
      const v = plan.value.trim();
      if (v) dayData.plans[slot] = v;
      else delete dayData.plans[slot];
      saveState();
      updateGroupMeta();
      updateScore();
    });
    main.appendChild(plan);

    if (actual?.status === "missed" && actual.note) {
      const a = document.createElement("div");
      a.className = "slot-actual";
      a.innerHTML = `<span class="tag missed">Actual</span> ${escapeHtml(actual.note)}`;
      main.appendChild(a);
    } else if (actual?.status === "done") {
      const a = document.createElement("div");
      a.className = "slot-actual";
      a.innerHTML = `<span class="tag done">Did it</span>`;
      main.appendChild(a);
    }
    row.appendChild(main);

    // Status buttons
    const status = document.createElement("div");
    status.className = "slot-status";

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

    status.appendChild(btnCheck);
    status.appendChild(btnX);
    row.appendChild(status);

    return row;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function toggleDone(slot) {
    const d = dayFor(currentDateKey);
    if (d.actuals[slot]?.status === "done") delete d.actuals[slot];
    else d.actuals[slot] = { status: "done" };
    saveState();
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
      const note = ta.value.trim();
      d.actuals[slot] = { status: "missed", note };
      saveState();
      modal.close();
      renderSlots();
    };
    const cancel = () => modal.close();
    const clear = () => {
      delete d.actuals[slot];
      saveState();
      modal.close();
      renderSlots();
    };

    $("#deviation-save").onclick = save;
    $("#deviation-cancel").onclick = d.actuals[slot]?.status === "missed" ? clear : cancel;
    $("#deviation-cancel").textContent = d.actuals[slot]?.status === "missed" ? "Clear" : "Cancel";

    modal.showModal();
    setTimeout(() => ta.focus(), 20);
  }

  // --------- Group meta + score ---------
  function statsFor(dayData) {
    let planned = 0, done = 0, missed = 0;
    for (const slot of SLOTS) {
      if (dayData.plans[slot]) planned++;
      if (dayData.actuals[slot]?.status === "done") done++;
      if (dayData.actuals[slot]?.status === "missed") missed++;
    }
    const pct = planned ? Math.round((done / planned) * 100) : 0;
    return { planned, done, missed, pct };
  }

  function updateGroupMeta() {
    const d = dayFor(currentDateKey);
    const groupStats = (g) => {
      let planned = 0, done = 0;
      SLOTS.filter((s) => groupFor(s) === g).forEach((s) => {
        if (d.plans[s]) planned++;
        if (d.actuals[s]?.status === "done") done++;
      });
      return { planned, done };
    };
    const fmt = ({ planned, done }) => planned ? `${done}/${planned}` : "— empty —";
    $("#meta-early").textContent = fmt(groupStats("early"));
    $("#meta-late").textContent = fmt(groupStats("late"));
  }

  function updateScore() {
    const d = dayFor(currentDateKey);
    const { planned, done, pct } = statsFor(d);
    $("#stat-points").textContent = done;
    $("#stat-planned").textContent = planned;
    $("#ring-pct").textContent = `${pct}%`;

    const circumference = 2 * Math.PI * 52;
    const fill = $("#ring-fill");
    fill.style.strokeDashoffset = String(circumference * (1 - Math.min(pct, 100) / 100));

    fill.classList.remove("below", "low");
    if (pct < 50) fill.classList.add("low");
    else if (pct < 80) fill.classList.add("below");

    $("#stat-streak").textContent = computeStreak();
  }

  function computeStreak() {
    // Consecutive days ending yesterday (or today if it already meets 80%) hitting >=80%
    // with at least 6 planned slots.
    let streak = 0;
    let cursor = new Date();
    // If today isn't >=80%, start from yesterday.
    const tKey = todayKey();
    const tStats = statsFor(dayFor(tKey));
    if (!(tStats.planned >= 6 && tStats.pct >= 80)) cursor = addDays(cursor, -1);

    for (let i = 0; i < 365; i++) {
      const k = fmtDateKey(cursor);
      const day = state.days[k];
      if (!day) break;
      const s = statsFor(day);
      if (s.planned >= 6 && s.pct >= 80) {
        streak++;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  // --------- Pinned banner: plan tomorrow at night ---------
  function maybeShowPlanTomorrow() {
    const now = new Date();
    const hour = now.getHours();
    // Show after 8pm if tomorrow has fewer than 4 planned slots.
    if (hour < 20) return;
    const tomorrow = fmtDateKey(addDays(now, 1));
    const td = state.days[tomorrow];
    const plannedCount = td ? Object.keys(td.plans).filter((k) => td.plans[k]).length : 0;
    if (plannedCount < 4) {
      $("#plan-tomorrow-banner").hidden = false;
    }
  }

  // --------- Group toggle ---------
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

  // --------- Day navigation ---------
  function wireNav() {
    $("#prev-day").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(parseDateKey(currentDateKey), -1));
      renderAll();
    });
    $("#next-day").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(parseDateKey(currentDateKey), 1));
      renderAll();
    });
    $("#today-btn").addEventListener("click", () => {
      currentDateKey = todayKey();
      renderAll();
    });
    $("#open-tomorrow").addEventListener("click", () => {
      currentDateKey = fmtDateKey(addDays(new Date(), 1));
      renderAll();
    });
  }

  // --------- History ---------
  function openHistory() {
    const modal = $("#history-modal");
    const body = $("#history-body");
    const keys = Object.keys(state.days).sort().reverse();
    if (!keys.length) {
      body.innerHTML = `<p class="muted">Nothing logged yet.</p>`;
    } else {
      // Summary bar: 30-day rolling average
      const last30 = keys.slice(0, 30).map((k) => statsFor(state.days[k])).filter((s) => s.planned > 0);
      const avg = last30.length
        ? Math.round(last30.reduce((a, s) => a + s.pct, 0) / last30.length)
        : 0;
      const hit80 = last30.filter((s) => s.pct >= 80).length;

      body.innerHTML = `
        <div class="card" style="margin-bottom:10px;padding:12px;">
          <strong>Last ${last30.length} logged day(s)</strong><br/>
          Average effectiveness: <strong>${avg}%</strong> · Days ≥ 80%: <strong>${hit80}</strong>
        </div>
        <div id="history-list"></div>
      `;
      const list = $("#history-list", body);
      keys.forEach((k) => {
        const s = statsFor(state.days[k]);
        const d = parseDateKey(k);
        const row = document.createElement("div");
        row.className = "history-day";
        const cls = s.pct >= 80 ? "good" : s.pct >= 50 ? "mid" : "low";
        row.innerHTML = `
          <div>
            <div><strong>${DOW[d.getDay()]}</strong> · ${MONTHS[d.getMonth()]} ${d.getDate()}</div>
            <div class="meta">${s.done}/${s.planned} slots followed${s.missed ? ` · ${s.missed} noted` : ""}</div>
          </div>
          <div class="history-pct ${cls}">${s.planned ? s.pct + "%" : "—"}</div>
          <button class="ghost" data-open="${k}">Open</button>
        `;
        list.appendChild(row);
      });
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-open]");
        if (!b) return;
        currentDateKey = b.dataset.open;
        modal.close();
        renderAll();
      });
    }
    modal.showModal();
  }

  // --------- Export ---------
  function dayToRows(key, d) {
    const rows = [];
    for (const slot of SLOTS) {
      const plan = d.plans[slot] || "";
      const a = d.actuals[slot];
      if (!plan && !a) continue;
      rows.push({
        date: key,
        slot,
        plan,
        status: a?.status || "",
        note: a?.note || ""
      });
    }
    return rows;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportCSV() {
    const header = ["date", "day", "slot", "plan", "status", "note", "points", "planned", "pct"];
    const lines = [header.join(",")];
    const keys = Object.keys(state.days).sort();
    for (const k of keys) {
      const d = state.days[k];
      const s = statsFor(d);
      const rows = dayToRows(k, d);
      if (!rows.length) continue;
      const dayName = DOW[parseDateKey(k).getDay()];
      for (const r of rows) {
        lines.push([
          r.date, dayName, r.slot,
          csv(r.plan), r.status, csv(r.note),
          r.status === "done" ? 1 : 0,
          s.planned, s.pct
        ].join(","));
      }
    }
    download(`bee-log-${todayKey()}.csv`, lines.join("\n"), "text/csv");
  }
  function csv(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportJSON() {
    download(`bee-log-${todayKey()}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  function copyTodayAsText() {
    const d = dayFor(currentDateKey);
    const s = statsFor(d);
    const date = parseDateKey(currentDateKey);
    const lines = [
      `${DOW[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
      `Effectiveness: ${s.pct}% (${s.done}/${s.planned})`,
      ""
    ];
    for (const slot of SLOTS) {
      const plan = d.plans[slot];
      const a = d.actuals[slot];
      if (!plan && !a) continue;
      let line = `${slot}  ${plan || "(no plan)"}`;
      if (a?.status === "done") line += "  ✓";
      else if (a?.status === "missed") line += `  ✗  actual: ${a.note || "—"}`;
      lines.push(line);
    }
    const text = lines.join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => flashStatus("Copied to clipboard."),
        () => fallbackCopy(text)
      );
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); flashStatus("Copied."); }
    catch { alert(text); }
    ta.remove();
  }

  let statusTimer;
  function flashStatus(msg) {
    const el = $("#sheets-status");
    const prev = el.innerHTML;
    el.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.innerHTML = prev; renderSheetsStatus(); }, 2500);
  }

  // --------- Google Sheets ---------
  function renderSheetsStatus() {
    const el = $("#sheets-status");
    if (state.sheets?.url) {
      el.innerHTML = `Google Sheet connected. <a href="#" id="configure-sheets-link">Change…</a>`;
      $("#configure-sheets-link").onclick = (e) => { e.preventDefault(); openSheetsModal(); };
    } else {
      el.innerHTML = `Google Sheet not configured. <a href="#" id="sheets-help">How to set up →</a>`;
      $("#sheets-help").onclick = (e) => { e.preventDefault(); openSheetsModal(); };
    }
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
    const d = dayFor(currentDateKey);
    const s = statsFor(d);
    const date = parseDateKey(currentDateKey);
    const payload = {
      secret: state.sheets.secret || "",
      date: currentDateKey,
      day: DOW[date.getDay()],
      points: s.done,
      planned: s.planned,
      missed: s.missed,
      pct: s.pct,
      rows: dayToRows(currentDateKey, d)
    };
    flashStatus("Pushing to Google Sheet…");
    try {
      const res = await fetch(url, {
        method: "POST",
        // Use text/plain so the browser does NOT send a preflight (Apps Script
        // webhooks don't handle CORS preflights well).
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      flashStatus("Pushed ✓");
    } catch (e) {
      console.warn(e);
      flashStatus("Push failed — check the web app URL.");
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
        $("#sheets-feedback").textContent = res.ok ? "OK — connection works." : `HTTP ${res.status}`;
      } catch (e) {
        $("#sheets-feedback").textContent = "Failed — is the web app deployed to ‘Anyone’?";
      }
    });
    $("#clear-sheets").addEventListener("click", () => {
      state.sheets = {};
      saveState();
      $("#sheets-url").value = "";
      $("#sheets-secret").value = "";
      $("#sheets-feedback").textContent = "Cleared.";
      renderSheetsStatus();
    });
  }

  // --------- Wiring ---------
  function wireButtons() {
    $("#history-btn").addEventListener("click", openHistory);
    $("#export-csv").addEventListener("click", exportCSV);
    $("#export-json").addEventListener("click", exportJSON);
    $("#copy-text").addEventListener("click", copyTodayAsText);
    $("#push-sheets").addEventListener("click", pushToSheets);
    $("#configure-sheets").addEventListener("click", openSheetsModal);
    $("#wipe").addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Wipe all BEE data on this device? This cannot be undone.")) {
        localStorage.removeItem(STORAGE_KEY);
        state = loadState();
        currentDateKey = todayKey();
        renderAll();
      }
    });
  }

  function renderAll() {
    renderHeader();
    renderQuote();
    renderSlots();
    renderSheetsStatus();
  }

  // --------- Theme ---------
  const THEME_KEY = "bee.theme";
  const THEME_ORDER = ["auto", "light", "dark"];
  const THEME_ICON  = { auto: "◐", light: "☀", dark: "☾" };
  const THEME_LABEL = { auto: "Theme: auto (system)", light: "Theme: light", dark: "Theme: dark" };

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const btn = $("#theme-toggle");
    const icon = $("#theme-icon");
    if (icon) icon.textContent = THEME_ICON[theme] || THEME_ICON.auto;
    if (btn) {
      btn.title = THEME_LABEL[theme] || THEME_LABEL.auto;
      btn.setAttribute("aria-label", btn.title);
    }
  }
  function loadTheme() {
    const t = localStorage.getItem(THEME_KEY);
    return THEME_ORDER.includes(t) ? t : "auto";
  }
  function wireThemeToggle() {
    const btn = $("#theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const cur = loadTheme();
      const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  // --------- Boot ---------
  // Apply saved theme as early as possible to avoid a flash of the wrong theme.
  applyTheme(loadTheme());

  document.addEventListener("DOMContentLoaded", () => {
    wireGroupToggles();
    wireNav();
    wireButtons();
    wireSheetsModal();
    wireThemeToggle();
    applyTheme(loadTheme()); // re-apply now that #theme-icon exists
    renderAll();
    maybeShowPlanTomorrow();
  });
})();

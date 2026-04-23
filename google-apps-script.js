/**
 * BEE — Google Apps Script web app.
 *
 * Setup:
 *   1. Create a Google Sheet. Rename the first sheet tab to "BEE" (or change SHEET_NAME below).
 *   2. Extensions → Apps Script. Paste this entire file into Code.gs and save.
 *   3. (Optional) Set SECRET below to match the secret you paste into BEE's Google Sheet config.
 *   4. Deploy → New deployment → Type: Web app.
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Copy the /exec URL and paste it into BEE → Configure Google Sheet.
 *
 * How it writes:
 *   - "BEE" tab: one row per slot (detailed log).
 *   - "Daily" tab: one row per day with rolling averages (recomputed on every push).
 */

const SHEET_NAME = "BEE";
const DAILY_NAME = "Daily";

// Optional: set to a non-empty string to require a matching secret from the client.
// Leave "" to allow any caller who has the URL.
const SECRET = "";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (SECRET && data.secret !== SECRET) {
      return _json({ ok: false, error: "bad secret" });
    }
    if (data.test) return _json({ ok: true, test: true });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const detail = _getOrCreateSheet(ss, SHEET_NAME, [
      "Timestamp", "Date", "Day", "Slot", "Plan", "Status", "Note", "Points"
    ]);
    const daily  = _getOrCreateSheet(ss, DAILY_NAME, [
      "Date", "Day", "Points", "Planned", "Missed", "Pct", "Rolling7", "Rolling30"
    ]);

    // --- Detail rows: replace the day's rows (Date is column 2) ---
    _deleteRowsFor(detail, data.date, 2);
    const now = new Date();
    const rows = (data.rows || []).map(r => [
      now, data.date, data.day, r.slot, r.plan, r.status, r.note,
      r.status === "done" ? 1 : 0
    ]);
    if (rows.length) {
      detail.getRange(detail.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    }

    // --- Daily row: upsert ---
    _upsertDaily(daily, data);

    return _json({ ok: true, rows: rows.length });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return _json({ ok: true, hello: "BEE" });
}

function _getOrCreateSheet(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _deleteRowsFor(sheet, date, dateColIndex) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const values = sheet.getRange(2, dateColIndex, last - 1, 1).getValues();
  // Walk from bottom to top so row indices stay valid when we delete.
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === date) sheet.deleteRow(i + 2);
  }
}

function _upsertDaily(sheet, data) {
  const last = sheet.getLastRow();
  let targetRow = -1;
  if (last >= 2) {
    const dates = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (String(dates[i][0]) === data.date) { targetRow = i + 2; break; }
    }
  }
  const row = [
    data.date, data.day, data.points, data.planned, data.missed, data.pct, "", ""
  ];
  if (targetRow === -1) targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);

  // Recompute rolling averages (7, 30 days) for all rows in place.
  const total = sheet.getLastRow();
  if (total < 2) return;
  const all = sheet.getRange(2, 1, total - 1, 6).getValues(); // Date..Pct
  // Sort by date ascending for rolling math, keep original order for write.
  const withIdx = all.map((r, i) => ({ i, date: r[0], pct: Number(r[5]) || 0 }));
  const sorted = withIdx.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rolling = sorted.map((entry, idx) => {
    const window7  = sorted.slice(Math.max(0, idx - 6), idx + 1).map(x => x.pct);
    const window30 = sorted.slice(Math.max(0, idx - 29), idx + 1).map(x => x.pct);
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return { i: entry.i, r7: avg(window7), r30: avg(window30) };
  });
  const out = new Array(all.length);
  rolling.forEach(r => { out[r.i] = [r.r7, r.r30]; });
  sheet.getRange(2, 7, out.length, 2).setValues(out);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

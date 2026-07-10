"use strict";
// Pure run-tracking + bio-row formatting logic (no I/O, unit-testable).
//
// A "run" = start% -> end% on a level. It QUALIFIES for the bio if it reached
// 100%, or spanned more than MIN_SPAN percentage points. Qualifying runs go into
// a rolling window of the most-recent MAX_ENTRIES distinct tokens; a repeated
// token collapses to "token xN". The row resets each local day.
//
// Token format:
//   from 0 (start<=1) -> end with %, e.g. "19%"
//   partial run       -> "start-end%", e.g. "57-100%"
//   repeat            -> count prefix, e.g. "2x15-100%"

const DEFAULTS = { MAX_ENTRIES: 3, MIN_SPAN: 30 };

function runToken(start, end) {
  return start <= 1 ? `${end}%` : `${start}-${end}%`;
}

function qualifies(start, end, minSpan) {
  return end >= 100 || (end - start) > minSpan;
}

// state: { date: "YYYY-MM-DD", entries: [{ token, count }] }  (oldest -> newest)
function freshState(date) {
  return { date, entries: [] };
}

// Add a run. Returns { state, changed }. `today` is a local YYYY-MM-DD string
// (passed in so the caller controls the clock — keeps this pure/testable).
function addRun(state, start, end, today, opts = {}) {
  const { MAX_ENTRIES, MIN_SPAN } = { ...DEFAULTS, ...opts };

  // Daily reset.
  if (!state || state.date !== today) state = freshState(today);

  // Clamp + sanity.
  start = Math.max(0, Math.min(100, Math.round(start)));
  end = Math.max(0, Math.min(100, Math.round(end)));
  if (end < start) end = start;

  if (!qualifies(start, end, MIN_SPAN)) return { state, changed: false };

  const token = runToken(start, end);
  const entries = state.entries.slice();
  const existing = entries.find(e => e.token === token);
  if (existing) {
    // Repeat: bump count and move to newest position.
    existing.count += 1;
    entries.splice(entries.indexOf(existing), 1);
    entries.push(existing);
  } else {
    entries.push({ token, count: 1 });
    while (entries.length > MAX_ENTRIES) entries.shift();
  }

  return { state: { date: today, entries }, changed: true };
}

// Render just the managed row (empty string if no runs yet today).
function formatRow(state) {
  if (!state || !state.entries.length) return "";
  return state.entries.map(e => (e.count > 1 ? `${e.count}x${e.token}` : e.token)).join(", ");
}

// Full bio = the untouched base + the managed row on its own line below it.
function buildBio(baseBio, state) {
  const row = formatRow(state);
  const base = (baseBio || "").replace(/\s+$/, "");
  if (!row) return base;
  return base ? `${base}\n${row}` : row;
}

module.exports = { runToken, qualifies, freshState, addRun, formatRow, buildBio, DEFAULTS };

// ── self-test: `node logic.js --test` ────────────────────────────────────────
if (require.main === module && process.argv.includes("--test")) {
  const assert = require("assert");
  const D = "2026-07-10";
  let s = freshState(D);

  // Sub-threshold, non-100 run is ignored (79->82 span 3).
  ({ state: s } = addRun(s, 79, 82, D));
  assert.strictEqual(formatRow(s), "", "sub-threshold run must not log");

  // From-0 death at 86 (span 86 > 30) -> "86%".
  ({ state: s } = addRun(s, 0, 86, D));
  assert.strictEqual(formatRow(s), "86%");

  // Partial 17->88 (span 71) -> appended.
  ({ state: s } = addRun(s, 17, 88, D));
  assert.strictEqual(formatRow(s), "86%, 17-88%");

  // Partial 29->100 (reached 100) -> appended (window now full at 3).
  ({ state: s } = addRun(s, 29, 100, D));
  assert.strictEqual(formatRow(s), "86%, 17-88%, 29-100%");

  // 4th distinct token drops the oldest ("86%" gone).
  ({ state: s } = addRun(s, 45, 100, D));
  assert.strictEqual(formatRow(s), "17-88%, 29-100%, 45-100%");

  // Repeat collapses to a count prefix and moves newest.
  ({ state: s } = addRun(s, 45, 100, D));
  assert.strictEqual(formatRow(s), "17-88%, 29-100%, 2x45-100%");

  // buildBio preserves the base bio and adds the row below.
  assert.strictEqual(buildBio("gravity", s), "gravity\n17-88%, 29-100%, 2x45-100%");

  // New day resets.
  ({ state: s } = addRun(s, 0, 90, "2026-07-11"));
  assert.strictEqual(formatRow(s), "90%");

  // Span exactly 30 does NOT qualify (must be > 30); 31 does.
  let t = freshState(D);
  ({ state: t } = addRun(t, 10, 40, D)); // span 30
  assert.strictEqual(formatRow(t), "", "span == 30 must not qualify");
  ({ state: t } = addRun(t, 10, 41, D)); // span 31
  assert.strictEqual(formatRow(t), "10-41%");

  console.log("all logic tests passed");
}

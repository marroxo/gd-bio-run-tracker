"use strict";
// Local bio updater. Receives runs from the Geode mod (POST /run) and live-updates
// the per-server Discord bio, preserving BASE_BIO and only managing the row below.
//
// Runs on the SAME PC as Geometry Dash (the mod POSTs to 127.0.0.1).
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { addRun, buildBio, formatRow } = require("./logic");
// Token + guild are resolved at runtime: the Geode mod pushes them with each run,
// falling back to .env. Set your token in the mod settings (in-game) or .env.
let TOKEN = process.env.DISCORD_TOKEN || "";      // your USER token (Nitro required for per-server bio)
let GUILD_ID = process.env.GUILD_ID || ""; // "" = global (About Me) bio; set an id for per-server

function ensureToken() { return TOKEN; }
// Base = everything above the runs row. Auto-fetched from your live bio by default;
// set BASE_BIO in .env to override/pin it (\n = line break).
let BASE_BIO = (process.env.BASE_BIO || "").replace(/\\n/g, "\n");
const BASE_PINNED = BASE_BIO.length > 0;

// Strip our own runs row off a fetched bio so we never fold it into the base.
// Handles the row on its own line OR appended inline after the base (Discord may
// return the bio single-line). Only strips a trailing run-token sequence that
// carries a run marker (-, x, %, or comma) so a base ending in a plain number
// (e.g. "level 19") is left intact.
const ROW_TAIL = /[\n ]*(?:\d{1,3}x)?\d{1,3}(?:-\d{1,3})?%?(?:\s*,\s*(?:\d{1,3}x)?\d{1,3}(?:-\d{1,3})?%?)*\s*$/;
function stripRow(bio) {
  return (bio || "").replace(/\r/g, "").replace(ROW_TAIL, m => (/[-x%,]/.test(m) ? "" : m)).replace(/\s+$/, "");
}
const PORT = parseInt(process.env.PORT || "8787", 10);
const OPTS = {
  MAX_ENTRIES: parseInt(process.env.MAX_ENTRIES || "3", 10),
  MIN_SPAN: parseInt(process.env.MIN_SPAN || "30", 10),
};
const STATE_FILE = path.join(__dirname, "state.json");

// ── state ────────────────────────────────────────────────────────────────────
let state = null;
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── Discord per-server bio update (debounced + 429-aware) ────────────────────
const SUPER_PROPS = Buffer.from(JSON.stringify({
  os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
  browser_version: "120.0.0.0", os_version: "10", release_channel: "stable", client_build_number: 263000,
})).toString("base64");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0";
const ownId = () => { try { return Buffer.from(TOKEN.split(".")[0], "base64").toString("utf8"); } catch { return null; } };

// Auto-fetch the current bio and derive the base (everything except our runs row).
// Skipped if BASE_BIO is pinned in .env. Refreshed periodically so manual edits stick.
async function refreshBase() {
  if (BASE_PINNED) return;
  const id = ownId();
  if (!id) return;
  try {
    const q = GUILD_ID ? `?guild_id=${GUILD_ID}&with_mutual_guilds=false` : "";
    const res = await fetch(`https://discord.com/api/v10/users/${id}/profile${q}`, {
      headers: { "Authorization": TOKEN, "User-Agent": UA, "X-Super-Properties": SUPER_PROPS },
    });
    if (!res.ok) { console.warn(`[base] fetch failed ${res.status}`); return; }
    const d = await res.json();
    // Per-server bio if a guild is set, otherwise the global About Me.
    const bio = GUILD_ID
      ? ((d.guild_member_profile && d.guild_member_profile.bio) || (d.user_profile && d.user_profile.bio) || "")
      : ((d.user_profile && d.user_profile.bio) || "");
    BASE_BIO = stripRow(bio);
    console.log(`[base] auto-fetched base: ${JSON.stringify(BASE_BIO)}`);
  } catch (e) {
    console.warn("[base] fetch error:", e.message);
  }
}

// Coalesce bursts: a 3s debounce AND a hard minimum interval between edits
// (Discord rate-limits profile edits). Many quick runs => one PATCH, latest wins.
const MIN_INTERVAL = parseInt(process.env.MIN_INTERVAL_MS || "10000", 10);
let pending = false, patchTimer = null, lastPatchAt = 0;
function scheduleBioUpdate() {
  pending = true;
  if (patchTimer) return;
  const since = Date.now() - lastPatchAt;
  const delay = Math.max(3000, MIN_INTERVAL - since);
  patchTimer = setTimeout(runBioUpdate, delay);
}

async function runBioUpdate() {
  patchTimer = null;
  if (!pending) return;
  if (!ensureToken()) { console.warn("[bio] no token available (set it in-game or install Discord desktop)"); pending = false; return; }
  pending = false;
  lastPatchAt = Date.now(); // gate the next edit by MIN_INTERVAL
  const bio = buildBio(BASE_BIO, state);
  try {
    const res = await fetch(`https://discord.com/api/v10/users/@me/profile`, {
      method: "PATCH",
      headers: {
        "Authorization": TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
        "X-Super-Properties": SUPER_PROPS,
      },
      body: JSON.stringify(GUILD_ID ? { guild_id: GUILD_ID, bio } : { bio }),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const wait = Math.ceil((data.retry_after || 5) * 1000) + 250;
      console.warn(`[bio] rate limited, retrying in ${wait}ms`);
      pending = true;
      patchTimer = setTimeout(runBioUpdate, wait);
      return;
    }
    if (res.status === 401) {
      console.warn("[bio] token invalid (401) — update it in the mod settings or .env");
      return;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[bio] update failed ${res.status}: ${t.slice(0, 200)}`);
      return;
    }
    console.log(`[bio] updated → row: "${formatRow(state)}"`);
  } catch (e) {
    console.warn("[bio] update error:", e.message);
    // retry once shortly
    pending = true;
    patchTimer = setTimeout(runBioUpdate, 5000);
  }
}

// ── HTTP: POST /run { level, start, end } ────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let run;
      try { run = JSON.parse(body); } catch { res.writeHead(400).end("bad json"); return; }
      // The mod pushes its configured token + server id alongside each run.
      if (typeof run.token === "string" && run.token.length > 20) TOKEN = run.token;
      if (run.server_id !== undefined) GUILD_ID = String(run.server_id).trim(); // "" = global
      const start = Number(run.start), end = Number(run.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) { res.writeHead(400).end("bad run"); return; }
      const out = addRun(state, start, end, today(), OPTS);
      state = out.state;
      res.writeHead(200).end(out.changed ? "logged" : "ignored");
      if (out.changed) {
        saveState();
        console.log(`[run] ${start}->${end}${run.level ? ` (${run.level})` : ""} → ${out.changed ? "logged" : "ignored"}`);
        scheduleBioUpdate();
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200).end("ok"); return; }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`bio-updater listening on http://127.0.0.1:${PORT} (guild ${GUILD_ID})`);
  ensureToken(); // grab from local Discord now if none configured
  await refreshBase(); // seed base from live bio (unless BASE_BIO pinned)
  console.log(`base: ${JSON.stringify(BASE_BIO)} | current row: "${formatRow(state)}"`);
  // Re-fetch the base every 10 min so manual bio edits (above the row) are kept.
  setInterval(refreshBase, 10 * 60 * 1000).unref?.();
});

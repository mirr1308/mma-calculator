import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 환경변수가 필요합니다.");

const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/global-top10?mode=current", {
  headers: { apikey: key, Authorization: "Bearer " + key }
});
const payload = await response.json();
if (!response.ok || !payload.ok || !Array.isArray(payload.rows) || payload.rows.length !== 30) {
  throw new Error("Supabase 현재 데이터 조회 실패: " + JSON.stringify(payload));
}

const collected = new Date(payload.collectedAt);
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(collected);
const year = date.slice(0, 4);
const file = path.join("history", year + ".json");
await fs.mkdir("history", { recursive: true });

let history = {};
try { history = JSON.parse(await fs.readFile(file, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const snapshot = payload.rows.map((row) => ({
  artist: row.artist,
  korea: Number(row.korea),
  global: Number(row.global)
})).sort((a,b) => a.artist.localeCompare(b.artist));

if (snapshot.some(r => !Number.isFinite(r.korea) || !Number.isFinite(r.global) || r.korea < 0 || r.global < 0)) {
  throw new Error("스냅샷에 유효하지 않은 득표수가 포함되어 있습니다.");
}
history[date] = snapshot;
const ordered = Object.fromEntries(Object.entries(history).sort(([a],[b]) => a.localeCompare(b)));
ordered._meta = {
  description: "Daily cumulative MMA votes. Derived ranks and scores are calculated by the dashboard.",
  timezone: "Asia/Seoul",
  updatedAt: payload.collectedAt,
  fields: ["artist", "korea", "global"]
};
await fs.writeFile(file, JSON.stringify(ordered, null, 2) + "\n");
console.log("Saved " + snapshot.length + " artists to " + file + " for " + date);

import { CHART_SCORES } from "./config.js";

const SUPABASE_URL = "https://kxrjzpwujwujtkjugpqu.supabase.co";
const SUPABASE_KEY = "sb_publishable_JK2kqztf_qC3GRGcP7_T2A_BQr7xO46";
const CURRENT_URL = SUPABASE_URL + "/functions/v1/global-top10?mode=current";
const HISTORY_URL = "./history/2026.json";

const $ = (id) => document.getElementById(id);
const number = (v) => new Intl.NumberFormat("ko-KR").format(v);
const dateLabel = (iso) => {
  const [, month, day] = iso.split("-");
  return Number(month) + "/" + Number(day);
};
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

async function collectVotes() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(SUPABASE_URL + "/functions/v1/global-top10", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY
      },
      body: JSON.stringify({ mode: "manual" }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "투표 수집에 실패했습니다.");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("수집 요청이 2분을 초과했습니다. Supabase와 History 저장 상태를 확인해 주세요.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCurrent() {
  const response = await fetch(CURRENT_URL, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "현재 데이터를 가져오지 못했습니다.");
  return data;
}

function dailyRows(history, date) {
  const entry = history[date];
  if (Array.isArray(entry)) return entry; // legacy daily format
  if (entry && Array.isArray(entry.snapshots) && entry.snapshots.length) {
    return entry.snapshots[entry.snapshots.length - 1].rows || [];
  }
  if (entry && Array.isArray(entry.rows)) return entry.rows;
  return [];
}

async function getHistory() {
  try {
    const response = await fetch(HISTORY_URL + "?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return {};
    return await response.json();
  } catch { return {}; }
}

function calculate(rows) {
  const maxVote = Math.max(...rows.map((r) => r.korea + r.global), 0);
  return rows.map((r) => {
    const totalVote = r.korea + r.global;
    const voteScore = maxVote ? round2(totalVote / maxVote * 20) : 0;
    const chartScore = CHART_SCORES[r.artist];
    return {
      ...r, totalVote, voteScore, chartScore,
      totalScore: Number.isFinite(chartScore) ? round2(chartScore + voteScore) : null
    };
  });
}

function rankRows(rows) {
  if (rows.some((r) => r.totalScore === null)) return null;
  return [...rows].sort((a,b) => b.totalScore - a.totalScore || b.totalVote - a.totalVote || a.artist.localeCompare(b.artist));
}

function previousSnapshot(history, currentDate) {
  const dates = Object.keys(history).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < currentDate).sort();
  return dates.length ? { date: dates.at(-1), rows: history[dates.at(-1)] } : null;
}

function table(el, headers, body) {
  el.querySelector("thead").innerHTML = "<tr>" + headers.map((h) => "<th>" + h + "</th>").join("") + "</tr>";
  el.querySelector("tbody").innerHTML = body || '<tr><td colspan="' + headers.length + '" class="muted">표시할 데이터가 없습니다.</td></tr>';
}

function renderCurrent(raw, history) {
  const calculated = calculate(raw.rows);
  const sorted = rankRows(calculated);
  const kstDate = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(raw.collectedAt));
  const previous = previousSnapshot(history, kstDate);
  const previousCalculated = previous ? calculate(dailyRows(history, previous.date)) : [];
  const previousRanked = rankRows(previousCalculated);
  const previousByName = new Map(previousCalculated.map((r) => [r.artist, r]));
  const previousRanks = new Map((previousRanked || []).map((r,i) => [r.artist, i+1]));
  $("max-vote").textContent = number(Math.max(...calculated.map(r => r.totalVote)));
  $("artist-count").textContent = raw.rowCount + " ARTISTS";
  $("updated-at").textContent = "수집 " + new Date(raw.collectedAt).toLocaleString("ko-KR", { timeZone:"Asia/Seoul" }) + " KST";

  const rows = (sorted || [...calculated].sort((a,b) => b.totalVote-a.totalVote)).map((r) => {
    const old = previousByName.get(r.artist);
    const scoreDelta = old && r.totalScore !== null && Number.isFinite(CHART_SCORES[r.artist])
      ? round2(r.totalScore - (old.chartScore + old.voteScore)) : null;
    const rank = sorted ? sorted.findIndex(x => x.artist === r.artist) + 1 : "—";
    const oldRank = previousRanks.get(r.artist);
    const rankDelta = oldRank && sorted ? oldRank - rank : null;
    const deltaHtml = scoreDelta === null ? '<span class="muted">—</span>' :
      '<span class="' + (scoreDelta > 0 ? "up" : scoreDelta < 0 ? "down" : "flat") + '">' +
      (scoreDelta > 0 ? "▲ " : scoreDelta < 0 ? "▼ " : "– ") + Math.abs(scoreDelta).toFixed(2) + '</span>';
    const rankHtml = rankDelta === null ? '<span class="muted">—</span>' :
      '<span class="' + (rankDelta > 0 ? "up" : rankDelta < 0 ? "down" : "flat") + '">' +
      (rankDelta > 0 ? "▲ " + rankDelta : rankDelta < 0 ? "▼ " + Math.abs(rankDelta) : "–") + '</span>';
    return '<tr><td>' + r.artist + '</td><td class="rank">' + rank + '</td><td>' + number(r.totalVote) +
      '</td><td>' + r.voteScore.toFixed(2) + '</td><td>' + (r.chartScore === null ? "미설정" : r.chartScore.toFixed(2)) +
      '</td><td class="score">' + (r.totalScore === null ? "미설정" : r.totalScore.toFixed(2)) +
      '</td><td>' + deltaHtml + '</td><td>' + rankHtml + '</td></tr>';
  }).join("");
  table($("current-table"), ["아티스트","현재 순위","Total Vote","Vote Score","Chart Score","Total Score","점수 증감","순위 증감"], rows);
  const complete = Object.values(CHART_SCORES).every(Number.isFinite);
  $("score-hint").textContent = complete
    ? (previous ? dateLabel(previous.date) + " 최종 스냅샷과 비교했습니다." : "이전 날짜 스냅샷이 없어 증감은 표시하지 않습니다.")
    : "Chart Score 30개 중 일부 또는 전체가 미설정입니다. config.js에 원본 점수를 입력하면 Total Score 순위와 점수 증감이 자동 계산됩니다.";
  $("max-score").textContent = "20.00";
}

function renderHistory(history) {
  const dates = Object.keys(history).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const latestRows = dates.length ? dailyRows(history, dates.at(-1)) : [];
  const artists = latestRows.map(r => r.artist).sort((a,b)=>a.localeCompare(b));
  const rankByDate = new Map();
  for (const date of dates) rankByDate.set(date, rankRows(calculate(dailyRows(history, date))));
  const rankBody = artists.map((artist) => {
    const cells = dates.map((date) => {
      const ranked = rankByDate.get(date);
      const rank = ranked ? ranked.findIndex(r => r.artist === artist) + 1 : 0;
      return "<td>" + (rank > 0 ? '<span class="rank">' + rank + '</span>' : '<span class="muted">—</span>') + "</td>";
    }).join("");
    return "<tr><td>" + artist + "</td>" + cells + "</tr>";
  }).join("");
  table($("rank-table"), ["아티스트", ...dates.map(dateLabel)], rankBody);

  const voteBody = artists.map((artist) => {
    const cells = dates.map((date, index) => {
      if (index === 0) return '<td class="muted">—</td>';
      const now = dailyRows(history, date).find(r => r.artist === artist);
      const before = dailyRows(history, dates[index-1]).find(r => r.artist === artist);
      if (!now || !before) return '<td class="muted">—</td>';
      const g = now.global - before.global;
      const k = now.korea - before.korea;
      return '<td><span class="' + (g >= 0 ? "up" : "down") + '">' + (g > 0 ? "+" : "") + number(g) +
        '</span><br><span class="muted">' + (k > 0 ? "+" : "") + number(k) + '</span></td>';
    }).join("");
    return "<tr><td>" + artist + "</td>" + cells + "</tr>";
  }).join("");
  table($("votes-table"), ["아티스트", ...dates.map(dateLabel)], voteBody);
}

async function refresh() {
  const button = $("refresh-button");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "투표 수집 중…";
  $("data-status").textContent = "Melon · Berriz 수집 중";
  $("data-status").className = "status";
  try {
    const collected = await collectVotes();
    $("data-status").textContent = "Supabase 저장 완료 · History 확인 중";
    const [current, history] = await Promise.all([getCurrent(), getHistory()]);
    renderCurrent(current, history);
    renderHistory(history);
    if (collected.historySaved) {
      $("data-status").textContent = "저장 완료 · " + current.rowCount + " ARTISTS";
      $("data-status").className = "status ok";
    } else {
      $("data-status").textContent = "투표 갱신 완료 · History 저장 실패";
      $("data-status").className = "status error";
      $("score-hint").textContent = "Supabase 투표는 갱신됐지만 GitHub History 저장에 실패했습니다: " + (collected.historyError || "원인 미확인");
    }
  } catch (error) {
    $("data-status").textContent = "수집 실패";
    $("data-status").className = "status error";
    $("current-table").querySelector("tbody").innerHTML = '<tr><td colspan="8">' + String(error.message) + '</td></tr>';
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}
$("refresh-button").addEventListener("click", refresh);
refresh();

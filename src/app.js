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
  if (Array.isArray(entry)) return entry; // Legacy official daily format
  if (entry && Array.isArray(entry.rows)) return entry.rows;
  if (entry && Array.isArray(entry.snapshots) && entry.snapshots.length) {
    return entry.snapshots[entry.snapshots.length - 1].rows || [];
  }
  const latest = history?._meta?.latestSnapshot;
  if (latest && latest.date === date && Array.isArray(latest.rows) && latest.rows.length) return latest.rows;
  return [];
}

function dailyHistoryDates(history) {
  const dailyMap = history?._meta?.dailySnapshotAtByDate;
  if (dailyMap && typeof dailyMap === "object" && !Array.isArray(dailyMap)) {
    return Object.keys(dailyMap)
      .filter((date) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) && dailyRows(history, date).length > 0)
      .concat(
        history?._meta?.latestSnapshot?.date &&
        history._meta.latestSnapshot.date <= "2026-11-13" &&
        Array.isArray(history._meta.latestSnapshot.rows) &&
        history._meta.latestSnapshot.rows.length
          ? [history._meta.latestSnapshot.date] : []
      )
      .filter((date, index, all) => all.indexOf(date) === index)
      .sort();
  }
  // Before this marker existed, date rows were the legacy daily records.
  return Object.keys(history)
    .filter((date) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) && dailyRows(history, date).length > 0)
    .sort();
}

// The target artist identifier is kept in JS; it is never rendered as a label in the HTML.
function koreaDateKey(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(iso)).map((part) => [part.type, part.value])
  );
  return parts.year + "-" + parts.month + "-" + parts.day;
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

function previousSnapshot(history, currentCollectedAt) {
  const meta = history?._meta || {};
  const latest = meta.latestSnapshot;
  const previous = meta.previousSnapshot;

  // The latest saved snapshot represents the current reading if timestamps match.
  // In that case compare against the snapshot immediately before it.
  if (
    latest && typeof latest.collectedAt === "string" &&
    Date.parse(latest.collectedAt) <= Date.parse(currentCollectedAt)
  ) {
    if (
      Date.parse(latest.collectedAt) === Date.parse(currentCollectedAt) &&
      previous && Array.isArray(previous.rows)
    ) {
      return previous;
    }
    if (Array.isArray(latest.rows)) return latest;
  }

  // If the live Supabase value is newer than the latest saved History entry,
  // compare against that latest saved entry while GitHub catches up.
  if (latest && Array.isArray(latest.rows)) return latest;

  // Backward compatibility for older History JSON without snapshot metadata.
  const dates = dailyHistoryDates(history)
    .filter((d) => d < currentCollectedAt.slice(0, 10));
  return dates.length
    ? { date: dates.at(-1), collectedAt: history._meta?.lastCollectedAtByDate?.[dates.at(-1)] || null, rows: dailyRows(history, dates.at(-1)) }
    : null;
}

function table(el, headers, body) {
  el.querySelector("thead").innerHTML = "<tr>" + headers.map((h) => "<th>" + h + "</th>").join("") + "</tr>";
  el.querySelector("tbody").innerHTML = body || '<tr><td colspan="' + headers.length + '" class="muted">표시할 데이터가 없습니다.</td></tr>';
}

function renderCurrent(raw, history) {
  const calculated = calculate(raw.rows);
  const sorted = rankRows(calculated);
  const previous = previousSnapshot(history, raw.collectedAt);
  const previousCalculated = previous ? calculate(previous.rows || dailyRows(history, previous.date)) : [];
  const previousByName = new Map(previousCalculated.map((r) => [r.artist, r]));
  $("max-vote").textContent = number(Math.max(...calculated.map(r => r.totalVote)));
  $("updated-at").textContent = "수집 " + new Date(raw.collectedAt).toLocaleString("ko-KR", { timeZone:"Asia/Seoul" }) + " KST";

  const rows = (sorted || [...calculated].sort((a,b) => b.totalVote-a.totalVote)).map((r) => {
    const old = previousByName.get(r.artist);
    const scoreDelta = old && r.totalScore !== null && Number.isFinite(CHART_SCORES[r.artist])
      ? round2(r.totalScore - (old.chartScore + old.voteScore)) : null;
    const rank = sorted ? sorted.findIndex(x => x.artist === r.artist) + 1 : "—";
    const deltaHtml = scoreDelta === null ? '<span class="muted">—</span>' :
      '<span class="' + (scoreDelta > 0 ? "up" : scoreDelta < 0 ? "down" : "flat") + '">' +
      (scoreDelta > 0 ? "▲ " : scoreDelta < 0 ? "▼ " : "– ") + Math.abs(scoreDelta).toFixed(2) + '</span>';
    return '<tr><td>' + r.artist + '</td><td class="rank">' + rank + '</td><td>' + number(r.totalVote) +
      '</td><td>' + r.voteScore.toFixed(2) + '</td><td>' + (r.chartScore === null ? "미설정" : r.chartScore.toFixed(2)) +
      '</td><td class="score">' + (r.totalScore === null ? "미설정" : r.totalScore.toFixed(2)) +
      '</td><td>' + deltaHtml + '</td></tr>';
  }).join("");
  table($("current-table"), ["아티스트","현재 순위","Total Vote","Vote Score","Chart Score","Total Score","점수 증감"], rows);
  const complete = Object.values(CHART_SCORES).every(Number.isFinite);
  $("score-hint").textContent = complete
    ? (previous
      ? (previous.collectedAt
        ? new Date(previous.collectedAt).toLocaleString("ko-KR", { timeZone:"Asia/Seoul" }) + " 수집 기록과 비교했습니다."
        : "직전 저장 기록과 비교했습니다.")
      : "비교할 이전 수집 기록이 없어 증감은 표시하지 않습니다.")
    : "Chart Score 30개 중 일부 또는 전체가 미설정입니다. config.js에 원본 점수를 입력하면 Total Score 순위와 점수 증감이 자동 계산됩니다.";
}

const NET_VOTE_CHART_SERIES = [
  ["BTS", ["#A78BFA"]],
  ["aespa", ["#B9E7FF", "#DCCBFA"]],
  ["BIGBANG", ["#F4D35E"]],
  ["IVE", ["#F48FB1"]],
  ["SEVENTEEN", ["#F4A6D0", "#A9DDF5"]],
  ["CORTIS", ["#78C98B"]],
  ["ILLIT", ["#AAB2BD"]],
  ["TOMORROW X TOGETHER", ["#42C6C5"]],
  ["G-DRAGON", ["#F2E6A0"]],
  ["NCT WISH", ["#B7F34A"]],
  ["RIIZE", ["#FF963F"]],
  ["TWICE", ["#F6A8CB", "#FFC19B"]],
  ["Hearts2Hearts", ["#8ED8F5"]],
  ["LE SSERAFIM", ["#558BEA"]],
  ["BOYNEXTDOOR", ["#8BD8F7", "#477FE0"]],
  ["i-dle", ["#B58BEF"]],
  ["Stray Kids", ["#E9515F"]],
  ["IU", ["#A87955"]],
  ["RESCENE", ["#F1B8D0"]],
  ["ENHYPEN", ["#6B7280"]]
];

function renderNetVoteChart(history, dates) {
  const mount = $("net-vote-chart");
  if (!mount) return;

  const chartDates = dates.slice(1);
  const chartDateLabel = (date) => dateLabel(date);
  if (!chartDates.length) {
    mount.innerHTML = '<p class="muted">비교할 전날 기록이 아직 없습니다. 두 번째 23:59(KST) 스냅샷부터 그래프가 표시됩니다.</p>';
    return;
  }

  const rowsByDate = chartDates.map((date) =>
    new Map(dailyRows(history, date).map((row) => [row.artist, row]))
  );
  const previousRowsByDate = chartDates.map((date, index) =>
    new Map(dailyRows(history, dates[index]).map((row) => [row.artist, row]))
  );

  const series = NET_VOTE_CHART_SERIES.map(([artist, colors], index) => ({
    artist,
    colors,
    id: "net-vote-gradient-" + index,
    values: chartDates.map((date, dateIndex) => {
      const current = rowsByDate[dateIndex].get(artist);
      const previous = previousRowsByDate[dateIndex].get(artist);
      if (!current || !previous) return null;
      const globalDelta = Number(current.global) - Number(previous.global);
      const koreaDelta = Number(current.korea) - Number(previous.korea);
      const total = globalDelta + koreaDelta;
      return Number.isFinite(total) ? total : null;
    })
  }));

  const allValues = series.flatMap((item) => item.values.filter((value) => value !== null));
  if (!allValues.length) {
    mount.innerHTML = '<p class="muted">표시할 일일 순증가 데이터가 아직 없습니다.</p>';
    return;
  }

  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);
  const span = Math.max(1, rawMax - rawMin);
  const minValue = rawMin < 0 ? rawMin - span * 0.08 : 0;
  const maxValue = rawMax > 0 ? rawMax + span * 0.08 : 1;

  const margin = { top: 24, right: 28, bottom: 58, left: 92 };
  const plotHeight = 330;
  const plotWidth = Math.max(620, (chartDates.length - 1) * 118);
  const width = margin.left + plotWidth + margin.right;
  const height = margin.top + plotHeight + margin.bottom;
  const x = (index) => margin.left + (chartDates.length === 1 ? plotWidth / 2 : index / (chartDates.length - 1) * plotWidth);
  const y = (value) => margin.top + (maxValue - value) / (maxValue - minValue) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) =>
    minValue + (maxValue - minValue) * index / 4
  );

  const defs = series
    .filter((item) => item.colors.length > 1)
    .map((item) =>
      '<linearGradient id="' + item.id + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
      item.colors.map((color, index) =>
        '<stop offset="' + (index / (item.colors.length - 1) * 100) + '%" stop-color="' + color + '"/>'
      ).join("") +
      '</linearGradient>'
    ).join("");

  const grid = ticks.map((tick) => {
    const py = y(tick);
    return '<g>' +
      '<line x1="' + margin.left + '" y1="' + py + '" x2="' + (width - margin.right) + '" y2="' + py + '" stroke="#30394a" stroke-width="1"/>' +
      '<text x="' + (margin.left - 12) + '" y="' + (py + 4) + '" text-anchor="end" fill="#aeb8c9" font-size="11">' + number(Math.round(tick)) + '</text>' +
      '</g>';
  }).join("");

  const xLabels = chartDates.map((date, index) =>
    '<text x="' + x(index) + '" y="' + (height - 22) + '" text-anchor="middle" fill="#aeb8c9" font-size="11">' + dateLabel(date) + '</text>'
  ).join("");

  const lines = series.map((item, seriesIndex) => {
    const segments = [];
    let currentSegment = [];
    item.values.forEach((value, index) => {
      if (value === null) {
        if (currentSegment.length) segments.push(currentSegment);
        currentSegment = [];
        return;
      }
      currentSegment.push({ x: x(index), y: y(value) });
    });
    if (currentSegment.length) segments.push(currentSegment);

    const path = segments.map((segment) =>
      segment.map((point, index) => (index === 0 ? "M " : "L ") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ")
    ).join(" ");
    const stroke = item.colors.length > 1 ? "url(#" + item.id + ")" : item.colors[0];
    const points = item.values.map((value, index) => value === null ? "" :
      '<circle class="net-chart-point" data-series-index="' + seriesIndex + '" data-value-index="' + index + '" tabindex="0" role="button" aria-label="' + item.artist + ' ' + chartDateLabel(chartDates[index]) + ' ' + number(value) + '표" cx="' + x(index) + '" cy="' + y(value) + '" r="4.2" fill="' + item.colors[0] + '" stroke="#111722" stroke-width="1.2"/>'
    ).join("");

    const visibleLine = path
      ? '<path class="net-chart-line" d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : "";
    const hitLine = path
      ? '<path class="net-chart-hit" data-series-index="' + seriesIndex + '" d="' + path + '" fill="none" stroke="#ffffff" stroke-opacity="0.01" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/>'
      : "";

    return '<g class="net-chart-series" data-series-index="' + seriesIndex + '">' +
      '<title>' + item.artist + '</title>' + visibleLine + hitLine + points + '</g>';
  }).join("");

  const legend = series.map((item, index) => {
    const swatch = item.colors.length > 1
      ? "linear-gradient(90deg," + item.colors.join(",") + ")"
      : item.colors[0];
    return '<button type="button" class="net-chart-legend-button" data-series-index="' + index + '" aria-label="' + item.artist + ' 그래프 선 강조">' +
      '<span class="net-chart-swatch" style="background:' + swatch + '"></span>' +
      '<span>' + item.artist + '</span></button>';
  }).join("");

  mount.innerHTML =
    '<div class="net-chart-shell">' +
      '<div class="net-chart-scroll"><svg class="net-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="20개 아티스트의 일자별 총 순증가 득표 선형 그래프">' +
      '<defs>' + defs + '</defs>' +
      '<text x="' + margin.left + '" y="13" fill="#aeb8c9" font-size="10">일일 순증가 득표수</text>' +
      grid + xLabels + lines +
      '</svg></div>' +
      '<div class="net-chart-tooltip" role="status" aria-live="polite"></div>' +
    '</div><div class="net-chart-legend">' + legend + '</div>';

  const svg = mount.querySelector(".net-chart-svg");
  const shell = mount.querySelector(".net-chart-shell");
  const tooltip = mount.querySelector(".net-chart-tooltip");
  let tooltipTimer = null;
  let highlightTimer = null;

  const hideTooltip = () => tooltip.classList.remove("is-visible");

  const showTooltip = (seriesIndex, dateIndex, event) => {
    const item = series[seriesIndex];
    const value = item && item.values[dateIndex];
    if (value === null || value === undefined) return;

    const signedValue = (value > 0 ? "+" : "") + number(value);
    tooltip.textContent = item.artist + " · " + chartDateLabel(chartDates[dateIndex]) + " · " + signedValue + "표";
    const shellRect = shell.getBoundingClientRect();
    const pointerX = event && Number.isFinite(event.clientX)
      ? event.clientX - shellRect.left + 14
      : shellRect.width / 2;
    const pointerY = event && Number.isFinite(event.clientY)
      ? event.clientY - shellRect.top - 42
      : 20;
    const left = Math.max(8, Math.min(pointerX, shellRect.width - 220));
    const top = Math.max(8, Math.min(pointerY, shellRect.height - 48));
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
    tooltip.classList.add("is-visible");
  };

  const closestDateIndex = (event, target) => {
    const explicitIndex = target.getAttribute("data-value-index");
    if (explicitIndex !== null) return Number(explicitIndex);

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return 0;
    const local = point.matrixTransform(matrix.inverse());
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < chartDates.length; index++) {
      const distance = Math.abs(x(index) - local.x);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const handleChartPointer = (event) => {
    const target = event.target.closest("[data-series-index]");
    if (!target) return;
    const seriesIndex = Number(target.getAttribute("data-series-index"));
    if (!Number.isInteger(seriesIndex) || !series[seriesIndex]) return;
    const dateIndex = closestDateIndex(event, target);
    showTooltip(seriesIndex, dateIndex, event);
  };

  svg.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && event.buttons === 0) return;
    handleChartPointer(event);
  });
  svg.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    if (tooltipTimer) window.clearTimeout(tooltipTimer);
    handleChartPointer(event);
  });
  svg.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    if (tooltipTimer) window.clearTimeout(tooltipTimer);
    tooltipTimer = window.setTimeout(hideTooltip, 2600);
  });
  svg.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") hideTooltip();
  });
  svg.addEventListener("focusin", (event) => {
    const target = event.target.closest(".net-chart-point");
    if (!target) return;
    const seriesIndex = Number(target.getAttribute("data-series-index"));
    const dateIndex = Number(target.getAttribute("data-value-index"));
    showTooltip(seriesIndex, dateIndex, null);
  });
  svg.addEventListener("focusout", hideTooltip);

  const legendButtons = [...mount.querySelectorAll(".net-chart-legend-button")];
  const clearHighlight = () => {
    svg.querySelectorAll(".net-chart-series").forEach((element) => {
      element.classList.remove("is-highlighted", "is-dimmed");
    });
    legendButtons.forEach((button) => button.classList.remove("is-selected"));
  };

  legendButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (highlightTimer) window.clearTimeout(highlightTimer);
      clearHighlight();
      const selectedIndex = Number(button.getAttribute("data-series-index"));
      svg.querySelectorAll(".net-chart-series").forEach((element) => {
        const isSelected = Number(element.getAttribute("data-series-index")) === selectedIndex;
        element.classList.toggle("is-highlighted", isSelected);
        element.classList.toggle("is-dimmed", !isSelected);
      });
      button.classList.add("is-selected");
      highlightTimer = window.setTimeout(clearHighlight, 2800);
    });
  });
}


function renderHistory(history, currentData) {
  // Merge the newest read-only Supabase snapshot into its KST calendar-date column.
  const viewHistory = { ...history, _meta: { ...(history?._meta || {}) } };
  const liveDate = currentData?.collectedAt ? koreaDateKey(currentData.collectedAt) : null;
  const savedSnapshot = history?._meta?.latestSnapshot;
  if (liveDate && liveDate <= "2026-11-13" &&
      Array.isArray(currentData.rows) && currentData.rows.length &&
      (!savedSnapshot?.collectedAt || Date.parse(currentData.collectedAt) >= Date.parse(savedSnapshot.collectedAt))) {
    viewHistory[liveDate] = { rows: currentData.rows };
    viewHistory._meta.dailySnapshotAtByDate = { ...(viewHistory._meta.dailySnapshotAtByDate || {}), [liveDate]: currentData.collectedAt };
  }
  history = viewHistory;
  // Sections 02–05 display dated columns only.
  const dates = dailyHistoryDates(history);
  if (!dates.length) {
    const waiting = '<tr><td class="muted">아직 23:59(KST) 일일 스냅샷이 없습니다. 오늘 기록은 23:59 자동 수집 후 표시됩니다.</td></tr>';
    table($("rank-table"), ["기록 상태"], waiting);
    table($("score-trend-table"), ["기록 상태"], waiting);
    table($("votes-table"), ["기록 상태"], waiting);
    renderNetVoteChart(history, [], currentData, false);
    return;
  }

  // Keep the original 20-artist display scope; calculate ranks against all 30 artists.
  const artists = Object.entries(CHART_SCORES)
    .filter(([artist]) => artist !== "BLACKPINK")
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([artist]) => artist);

  // Section 03: daily Total Score change versus the previous calendar day.
  const scoresByDate = new Map(dates.map((date) => [
    date,
    new Map(calculate(dailyRows(history, date)).map((row) => [row.artist, row.totalScore]))
  ]));
  const scoreTrendBody = artists.map((artist) => {
    const cells = dates.map((date, index) => {
      const currentScore = scoresByDate.get(date)?.get(artist);
      if (index === 0) {
        return Number.isFinite(currentScore)
          ? '<td class="score">' + currentScore.toFixed(2) + '</td>'
          : '<td class="muted">—</td>';
      }
      const previousDateValue = new Date(date + "T00:00:00Z");
      previousDateValue.setUTCDate(previousDateValue.getUTCDate() - 1);
      const previousDate = previousDateValue.toISOString().slice(0, 10);
      const scoreForDate = scoresByDate.get(date)?.get(artist);
      const previousScore = scoresByDate.get(previousDate)?.get(artist);
      if (!Number.isFinite(scoreForDate) || !Number.isFinite(previousScore)) {
        return '<td class="muted">—</td>';
      }
      const delta = round2(scoreForDate - previousScore);
      const changeClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      const value = (delta > 0 ? "+" : "") + delta.toFixed(2);
      return '<td class="score-delta-cell"><span class="' + changeClass + '">' + value + '</span></td>';
    }).join("");
    // Sum daily changes from the first baseline through the latest dated snapshot.
    const dailyDeltas = dates.slice(1).map((date) => {
      const dateValue = new Date(date + "T00:00:00Z");
      dateValue.setUTCDate(dateValue.getUTCDate() - 1);
      const previousDate = dateValue.toISOString().slice(0, 10);
      const score = scoresByDate.get(date)?.get(artist);
      const previous = scoresByDate.get(previousDate)?.get(artist);
      return Number.isFinite(score) && Number.isFinite(previous)
        ? round2(score - previous)
        : null;
    });
    const accumulatedValues = dailyDeltas.filter(Number.isFinite);
    const accumulatedDelta = accumulatedValues.length
      ? round2(accumulatedValues.reduce((sum, value) => sum + value, 0))
      : null;
    const accumulatedCell = Number.isFinite(accumulatedDelta)
      ? '<td class="score-delta-cell"><span class="' +
        (accumulatedDelta > 0 ? "up" : accumulatedDelta < 0 ? "down" : "flat") +
        '">' + (accumulatedDelta > 0 ? "+" : "") + accumulatedDelta.toFixed(2) +
        '</span></td>'
      : '<td class="muted">—</td>';

    return "<tr><td>" + artist + "</td>" + cells + accumulatedCell + "</tr>";
  }).join("");
  table($("score-trend-table"), [
    "아티스트",
    ...dates.map((date, index) => index === 0 ? dateLabel(date) + " 기준 점수" : dateLabel(date)),
    "누적 증감"
  ], scoreTrendBody);

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
      const g = Number(now.global) - Number(before.global);
      const k = Number(now.korea) - Number(before.korea);
      const total = g + k;
      return '<td class="net-vote-cell">' +
        '<span class="net-vote-global">' + (g > 0 ? "+" : "") + number(g) + '</span>' +
        '<span class="net-vote-korea">' + (k > 0 ? "+" : "") + number(k) + '</span>' +
        '<span class="net-vote-total">' + (total > 0 ? "+" : "") + number(total) + '</span>' +
        '</td>';
    }).join("");
    return "<tr><td>" + artist + "</td>" + cells + "</tr>";
  }).join("");
  table($("votes-table"), ["아티스트", ...dates.map(dateLabel)], voteBody);
  renderNetVoteChart(history, dates);
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
    renderHistory(history, current);
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
    $("current-table").querySelector("tbody").innerHTML = '<tr><td colspan="7">' + String(error.message) + '</td></tr>';
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function loadDashboard() {
  const button = $("refresh-button");
  button.disabled = true;
  $("data-status").textContent = "저장된 데이터 불러오는 중";
  $("data-status").className = "status";
  try {
    const [current, history] = await Promise.all([getCurrent(), getHistory()]);
    renderCurrent(current, history);
    renderHistory(history, current);
    $("data-status").textContent = "LIVE · " + current.rowCount + " ARTISTS";
    $("data-status").className = "status ok";
  } catch (error) {
    $("data-status").textContent = "연결 실패";
    $("data-status").className = "status error";
    $("current-table").querySelector("tbody").innerHTML = '<tr><td colspan="7">' + String(error.message) + '</td></tr>';
  } finally {
    button.disabled = false;
  }
}

$("refresh-button").addEventListener("click", refresh);
loadDashboard();
window.setInterval(() => loadDashboard(), 5 * 60 * 1000);

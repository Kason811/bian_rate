#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");
const DB_PATH = path.resolve(ROOT_DIR, "data", "bian_rate.sqlite3");

process.chdir(WEB_DIR);

const {
  getBtcWeeklyResearch2Data,
  getResearchContractSymbol,
  loadResearchCandles,
  buildBtcSevenRegimeResearch,
  buildResearch2FromDailyMetrics,
} = await import("../web/lib/sqlite-workbench-data.ts");

const TUNINGS = [
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 2, splitPenalty: 7.8, maxSegmentWeeks: 40 },
];
const MARKETS = ["usdtm", "coinm"];
const TIMEFRAMES = ["day", "3day", "week"];
const TRANSITION_ORDER = [
  "Bull->Sideways",
  "Bear->Sideways",
  "Sideways->Bull",
  "Sideways->Bear",
  "Bull->Bear",
  "Bear->Bull",
];
const WINDOW_BARS = {
  day: 365,
  "3day": 365,
  week: Number.POSITIVE_INFINITY,
};
const MIN_WARMUP_BARS = 104;

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function familyToChinese(family) {
  if (family === "Bull") return "牛";
  if (family === "Bear") return "熊";
  return "震荡灰";
}

function transitionToChinese(transition) {
  const [from, to] = transition.split("->");
  return `${familyToChinese(from)} -> ${familyToChinese(to)}`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pushMapArray(map, key, value) {
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function summariseTransition(events, transition) {
  const rows = events.filter((event) => event.transition === transition);
  const continued = rows.filter((event) => event.familyContinuedNew).length;
  const reverted = rows.filter((event) => event.familyReverted).length;
  return {
    transition,
    transitionLabel: transitionToChinese(transition),
    count: rows.length,
    continuedRate: rows.length ? round(continued / rows.length) : 0,
    revertedRate: rows.length ? round(reverted / rows.length) : 0,
    avgTrendScore: round(mean(rows.map((event) => event.trendScore)), 3),
    avgLeverageScore: round(mean(rows.map((event) => event.leverageScore)), 3),
    avgParticipationScore: round(mean(rows.map((event) => event.participationScore)), 3),
  };
}

const datasetSeeds = [];
for (const timeframe of TIMEFRAMES) {
  for (const marketType of MARKETS) {
    const seed = await getBtcWeeklyResearch2Data({
      marketType,
      timeframe,
      symbol: "BTC",
      tuning: TUNINGS[0],
    });
    if (seed.loadError) continue;
    for (const symbol of seed.availableSymbols) {
      datasetSeeds.push({ marketType, timeframe, symbol });
    }
  }
}

const db = new DatabaseSync(DB_PATH, { open: true, readOnly: true });
const fundingStmt = db.prepare("SELECT metric_date, daily_funding_rate FROM daily_funding_metrics WHERE symbol = ? ORDER BY metric_date");
const volumeStmt = db.prepare("SELECT metric_date, usd_volume FROM daily_volume_metrics WHERE symbol = ? ORDER BY metric_date");
const weeklyFundingStmt = db.prepare("SELECT metric_week, weekly_funding_rate FROM weekly_funding_metrics WHERE symbol = ? ORDER BY metric_week");

const sourceCache = new Map();
function getSource(dataset) {
  const key = `${dataset.marketType}:${dataset.timeframe}:${dataset.symbol}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const contractSymbol = getResearchContractSymbol(dataset.symbol, dataset.marketType);
  const source = {
    candles: loadResearchCandles(dataset.symbol, dataset.marketType, dataset.timeframe),
    dailyFunding: fundingStmt.all(contractSymbol),
    dailyVolumes: volumeStmt.all(contractSymbol),
    weeklyFunding: dataset.timeframe === "week" ? weeklyFundingStmt.all(contractSymbol) : [],
  };
  sourceCache.set(key, source);
  return source;
}

function buildRealtimeSlice(source, timeframe, endIndex) {
  const bars = WINDOW_BARS[timeframe];
  const startIndex = Number.isFinite(bars) ? Math.max(0, endIndex - bars + 1) : 0;
  const candles = source.candles.slice(startIndex, endIndex + 1);
  const startWeek = candles[0]?.weekStart;
  const endWeek = candles.at(-1)?.weekEnd;
  if (!startWeek || !endWeek) return null;

  const dailyFunding = source.dailyFunding.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  const dailyVolumes = source.dailyVolumes.filter((row) => row.metric_date >= startWeek && row.metric_date <= endWeek);
  const weeklyFunding = timeframe === "week"
    ? source.weeklyFunding.filter((row) => row.metric_week.slice(0, 10) >= startWeek && row.metric_week.slice(0, 10) <= candles.at(-1).weekStart)
    : [];

  return { candles, dailyFunding, dailyVolumes, weeklyFunding };
}

const realtimeCache = new Map();
function getRealtimeResearch(dataset, source, tuning, endIndex) {
  const key = `${dataset.marketType}:${dataset.timeframe}:${dataset.symbol}:${tuningKey(tuning)}:${endIndex}`;
  if (realtimeCache.has(key)) return realtimeCache.get(key);
  const slice = buildRealtimeSlice(source, dataset.timeframe, endIndex);
  if (!slice) {
    realtimeCache.set(key, null);
    return null;
  }
  const built = dataset.timeframe === "week"
    ? buildBtcSevenRegimeResearch(slice.candles, slice.weeklyFunding, slice.dailyVolumes, { tuning })
    : buildResearch2FromDailyMetrics(slice.candles, slice.dailyFunding, slice.dailyVolumes, { tuning });
  realtimeCache.set(key, built);
  return built;
}

const rows = [];

for (const tuning of TUNINGS) {
  for (const dataset of datasetSeeds) {
    const source = getSource(dataset);
    const totalCandles = source.candles.length;
    if (totalCandles < MIN_WARMUP_BARS + 2) continue;
    for (let endIndex = MIN_WARMUP_BARS; endIndex < totalCandles - 1; endIndex += 1) {
      const current = getRealtimeResearch(dataset, source, tuning, endIndex);
      const next = getRealtimeResearch(dataset, source, tuning, endIndex + 1);
      if (!current || !next || current.segments.length < 2 || !current.points.length || !next.segments.length) continue;

      const lastSegment = current.segments.at(-1);
      const previousSegment = current.segments.at(-2);
      const nextLastSegment = next.segments.at(-1);
      const lastPoint = current.points.at(-1);
      if (!lastSegment || !previousSegment || !nextLastSegment || !lastPoint) continue;
      if (lastSegment.weeks !== tuning.latestSegmentMinWeeks) continue;
      if (lastSegment.family === previousSegment.family) continue;

      rows.push({
        timeframe: dataset.timeframe,
        marketType: dataset.marketType,
        symbol: dataset.symbol,
        tuningKey: tuningKey(tuning),
        tuning,
        transition: `${previousSegment.family}->${lastSegment.family}`,
        familyContinuedNew: nextLastSegment.family === lastSegment.family,
        familyReverted: nextLastSegment.family === previousSegment.family,
        trendScore: lastPoint.trendScore,
        leverageScore: lastPoint.leverageScore,
        participationScore: lastPoint.participationScore,
      });
    }
  }
}

const summaryRows = [];
for (const timeframe of TIMEFRAMES) {
  for (const tuning of TUNINGS) {
    const scoped = rows.filter((row) => row.timeframe === timeframe && row.tuningKey === tuningKey(tuning));
    summaryRows.push({
      timeframe,
      tuning,
      tuningKey: tuningKey(tuning),
      totalEvents: scoped.length,
      familyContinuationRate: scoped.length ? round(scoped.filter((row) => row.familyContinuedNew).length / scoped.length) : 0,
      familyReversionRate: scoped.length ? round(scoped.filter((row) => row.familyReverted).length / scoped.length) : 0,
      avgTrendScore: round(mean(scoped.map((row) => row.trendScore)), 3),
      avgLeverageScore: round(mean(scoped.map((row) => row.leverageScore)), 3),
      avgParticipationScore: round(mean(scoped.map((row) => row.participationScore)), 3),
      transitions: TRANSITION_ORDER.map((transition) => summariseTransition(scoped, transition))
        .sort((left, right) => right.continuedRate - left.continuedRate || right.count - left.count),
    });
  }
}

const bestByTimeframe = TIMEFRAMES.map((timeframe) => {
  const candidates = summaryRows
    .filter((row) => row.timeframe === timeframe)
    .sort((left, right) => right.familyContinuationRate - left.familyContinuationRate || right.totalEvents - left.totalEvents);
  return { timeframe, best: candidates[0] ?? null, runnerUp: candidates[1] ?? null };
});

const bestOverall = [...summaryRows].sort((left, right) => {
  if (right.familyContinuationRate !== left.familyContinuationRate) return right.familyContinuationRate - left.familyContinuationRate;
  return right.totalEvents - left.totalEvents;
})[0] ?? null;

const summary = {
  generatedAt: new Date().toISOString(),
  mode: "realtime-window-rebuild",
  windowBars: WINDOW_BARS,
  datasetCount: datasetSeeds.length,
  totalEvents: rows.length,
  bestOverall,
  bestByTimeframe,
  rows: summaryRows,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const jsonPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-continuation-realtime.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const mdLines = [
  "# Research2 Family Continuation Realtime",
  "",
  `生成时间: ${summary.generatedAt}`,
  "说明: 本结果按“实时重构图表”逻辑统计。每个时点都只用当时可见窗口数据重构最新区块，再判断下一根是否延续新家族。",
  `窗口设置: 周线=全历史, 3日线=${WINDOW_BARS["3day"]}根, 日线=${WINDOW_BARS.day}根`,
  `数据集数量: ${summary.datasetCount}`,
  `总事件数: ${summary.totalEvents}`,
  "",
];

if (bestOverall) {
  mdLines.push(`- 全部组合最佳: ${bestOverall.timeframe} / ${bestOverall.tuningKey}, 机会=${bestOverall.totalEvents}, 延续率=${pct(bestOverall.familyContinuationRate)}, 打回率=${pct(bestOverall.familyReversionRate)}`);
  mdLines.push("");
}

for (const item of bestByTimeframe) {
  if (!item.best) continue;
  mdLines.push(`## ${item.timeframe}`);
  mdLines.push(`- 最优: ${item.best.tuningKey}, 机会=${item.best.totalEvents}, 延续率=${pct(item.best.familyContinuationRate)}, 打回率=${pct(item.best.familyReversionRate)}`);
  if (item.runnerUp) {
    mdLines.push(`- 次优: ${item.runnerUp.tuningKey}, 机会=${item.runnerUp.totalEvents}, 延续率=${pct(item.runnerUp.familyContinuationRate)}, 打回率=${pct(item.runnerUp.familyReversionRate)}`);
  }
  mdLines.push("");
}

for (const row of summaryRows) {
  mdLines.push(`### ${row.timeframe} / ${row.tuningKey}`);
  mdLines.push(`- 机会数: ${row.totalEvents}`);
  mdLines.push(`- 延续率: ${pct(row.familyContinuationRate)}`);
  mdLines.push(`- 打回率: ${pct(row.familyReversionRate)}`);
  mdLines.push(`- 平均趋势/杠杆/参与复合: ${row.avgTrendScore.toFixed(2)} / ${row.avgLeverageScore.toFixed(2)} / ${row.avgParticipationScore.toFixed(2)}`);
  mdLines.push("- 最高命中转换:");
  for (const transition of row.transitions.slice(0, 3)) {
    mdLines.push(`  ${transition.transitionLabel}: 样本=${transition.count}, 延续率=${pct(transition.continuedRate)}, 打回率=${pct(transition.revertedRate)}`);
  }
  mdLines.push("");
}

const mdPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-continuation-realtime.md");
fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));

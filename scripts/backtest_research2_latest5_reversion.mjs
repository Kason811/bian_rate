#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");
const WARMUP_WEEKS = 104;
const MIN_RULE_SUPPORT = 5;
const MIN_TRANSITION_RULE_SUPPORT = 3;
const TUNINGS = [
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 5, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 5, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
];
const TRANSITION_ORDER = [
  "Bull->Sideways",
  "Bear->Sideways",
  "Sideways->Bull",
  "Sideways->Bear",
  "Bull->Bear",
  "Bear->Bull",
];

process.chdir(WEB_DIR);

const { getBtcWeeklyResearch2Data } = await import("../web/lib/sqlite-workbench-data.ts");

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

function familyLabel(family) {
  if (family === "Bull") return "绿";
  if (family === "Bear") return "红";
  return "灰";
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

function familyToSign(family) {
  if (family === "Bull") return 1;
  if (family === "Bear") return -1;
  return 0;
}

function sign(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function pctDistance(value, anchor) {
  if (!anchor) return 0;
  return ((value - anchor) / anchor) * 100;
}

function isAlignedToFamily(familySign, value, tolerance = 0) {
  if (familySign === 0) return Math.abs(value) <= tolerance;
  return sign(value) === familySign;
}

function combinationNames(names, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index < names.length; index += 1) {
    combinationNames(names, size, index + 1, [...prefix, names[index]], output);
  }
  return output;
}

function summarizeRules(events, predicateMap, targetKey, minSupport) {
  const names = Object.keys(predicateMap);
  const combos = [];
  for (let size = 1; size <= 3; size += 1) {
    combos.push(...combinationNames(names, size));
  }

  const baseline = events.length ? events.filter((event) => event[targetKey]).length / events.length : 0;

  return combos
    .map((combo) => {
      const matched = events.filter((event) => combo.every((name) => predicateMap[name](event)));
      if (matched.length < minSupport) return null;
      const wins = matched.filter((event) => event[targetKey]).length;
      return {
        rule: combo.join(" + "),
        support: matched.length,
        wins,
        precision: Number((wins / matched.length).toFixed(4)),
        lift: baseline > 0 ? Number(((wins / matched.length) / baseline).toFixed(4)) : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.precision !== a.precision) return b.precision - a.precision;
      if (b.support !== a.support) return b.support - a.support;
      return b.lift - a.lift;
    });
}

function buildPredicateMap() {
  return {
    "ADX<25": (event) => event.pointAdx14 < 25,
    "ADX<TrendLevel": (event) => event.weakTrend,
    "BBW<70": (event) => event.lowVolExpansion,
    "BBW<30": (event) => event.veryLowVolExpansion,
    "|ReturnZ|<0.5": (event) => event.weakImpulse,
    "RSI 40-60": (event) => event.midRsi,
    "Close aligns prev EMA side": (event) => event.alignPrevEma,
    "Close aligns prev SMA side": (event) => event.alignPrevSma,
    "ReturnZ aligns prev side": (event) => event.alignPrevReturnZ,
    "1W price aligns prev side": (event) => event.alignPrevPrice1w,
    "Segment slope aligns prev side": (event) => event.alignPrevSegmentSlope,
    "Segment avg return aligns prev side": (event) => event.alignPrevSegmentAvgReturn,
    "Seg ADX<TrendLevel": (event) => event.weakSegmentTrend,
    "Seg |cumReturn|<8": (event) => event.smallSegmentMove,
    "Seg posShare 40-60": (event) => event.segmentReturnShareNeutral,
  };
}

function buildEvent(current, next, tuning) {
  if (current.segments.length < 2 || !current.points.length || !next.segments.length) return null;

  const lastSegment = current.segments.at(-1);
  const previousSegment = current.segments.at(-2);
  const lastPoint = current.points.at(-1);
  const prevPoint = current.points.at(-2);
  const nextLastSegment = next.segments.at(-1);

  if (!lastSegment || !previousSegment || !lastPoint || !nextLastSegment) return null;
  if (lastSegment.weeks !== tuning.latestSegmentMinWeeks) return null;
  if (lastSegment.family === previousSegment.family) return null;

  const prevFamilySign = familyToSign(previousSegment.family);
  const emaGapPct = pctDistance(lastPoint.closePrice, lastPoint.ema21);
  const smaGapPct = pctDistance(lastPoint.closePrice, lastPoint.sma200);
  const priceChange1wPct = prevPoint ? pctDistance(lastPoint.closePrice, prevPoint.closePrice) : 0;

  return {
    eventWeek: current.points.at(-1)?.weekStart ?? "",
    nextWeek: next.points.at(-1)?.weekStart ?? "",
    tuningKey: tuningKey(tuning),
    previousLabel: previousSegment.label,
    previousFamily: previousSegment.family,
    previousFamilyColor: familyLabel(previousSegment.family),
    newLabel: lastSegment.label,
    newFamily: lastSegment.family,
    newFamilyColor: familyLabel(lastSegment.family),
    nextLabel: nextLastSegment.label,
    nextFamily: nextLastSegment.family,
    nextFamilyColor: familyLabel(nextLastSegment.family),
    transition: `${previousSegment.family}->${lastSegment.family}`,
    familyReverted: nextLastSegment.family === previousSegment.family,
    familyContinuedNew: nextLastSegment.family === lastSegment.family,
    pointAdx14: lastPoint.adx14,
    pointBbwPercentile104: lastPoint.bbwPercentile104,
    pointReturnZ52: lastPoint.returnZ52,
    pointRsi: lastPoint.rsi,
    pointFundingRatePct: lastPoint.fundingRatePct,
    pointAvgVolumeM: lastPoint.avgVolumeM,
    pointWeeklyReturnPct: lastPoint.weeklyReturnPct,
    pointClose: lastPoint.closePrice,
    pointEma21: lastPoint.ema21,
    pointSma200: lastPoint.sma200,
    emaGapPct,
    smaGapPct,
    segmentWeeks: lastSegment.weeks,
    segmentCumulativeReturnPct: lastSegment.cumulativeReturnPct,
    segmentAvgAdx14: lastSegment.avgAdx14,
    segmentAvgBbwPercentile104: lastSegment.avgBbwPercentile104,
    segmentAvgWeeklyReturnPct: lastSegment.avgWeeklyReturnPct,
    segmentPositiveReturnSharePct: lastSegment.positiveReturnSharePct,
    segmentPriceSlope: lastSegment.priceSlope,
    segmentTrendScore: lastSegment.trendScore,
    segmentAvgFundingRatePct: lastSegment.avgFundingRatePct,
    indicatorAdxTrendLevel: current.indicatorSettings.adxTrendLevel,
    indicatorBbwHigh: current.indicatorSettings.bbwHigh,
    indicatorBbwLow: current.indicatorSettings.bbwLow,
    alignPrevEma: isAlignedToFamily(prevFamilySign, emaGapPct, 2.5),
    alignPrevSma: isAlignedToFamily(prevFamilySign, smaGapPct, 4.0),
    alignPrevReturnZ: isAlignedToFamily(prevFamilySign, lastPoint.returnZ52, 0.35),
    alignPrevPrice1w: isAlignedToFamily(prevFamilySign, priceChange1wPct, 1.2),
    alignPrevSegmentSlope: isAlignedToFamily(prevFamilySign, lastSegment.priceSlope, 0.0008),
    alignPrevSegmentAvgReturn: isAlignedToFamily(prevFamilySign, lastSegment.avgWeeklyReturnPct, 0.35),
    weakImpulse: Math.abs(lastPoint.returnZ52) < 0.5,
    weakTrend: lastPoint.adx14 < current.indicatorSettings.adxTrendLevel,
    lowVolExpansion: lastPoint.bbwPercentile104 < current.indicatorSettings.bbwHigh,
    veryLowVolExpansion: lastPoint.bbwPercentile104 < current.indicatorSettings.bbwLow,
    weakSegmentTrend: lastSegment.avgAdx14 < current.indicatorSettings.adxTrendLevel,
    smallSegmentMove: Math.abs(lastSegment.cumulativeReturnPct) < 8,
    midRsi: lastPoint.rsi >= 40 && lastPoint.rsi <= 60,
    segmentReturnShareNeutral: lastSegment.positiveReturnSharePct >= 40 && lastSegment.positiveReturnSharePct <= 60,
  };
}

function summarizeTransition(events, transition) {
  const rows = events.filter((event) => event.transition === transition);
  const reverted = rows.filter((event) => event.familyReverted).length;
  const continued = rows.filter((event) => event.familyContinuedNew).length;
  const topRules = summarizeRules(rows, buildPredicateMap(), "familyReverted", MIN_TRANSITION_RULE_SUPPORT).slice(0, 5);
  return {
    transition,
    transitionLabel: transitionToChinese(transition),
    count: rows.length,
    reverted,
    continued,
    revertedRate: rows.length ? Number((reverted / rows.length).toFixed(4)) : 0,
    continuedRate: rows.length ? Number((continued / rows.length).toFixed(4)) : 0,
    topRules,
  };
}

const baseData = await getBtcWeeklyResearch2Data({ tuning: TUNINGS[0] });
if (baseData.loadError) {
  throw new Error(`Failed to load research2 data: ${baseData.loadError}`);
}

const weekStarts = baseData.points.map((point) => point.weekStart);
const dataCache = new Map();

async function getDataByEndWeek(tuning, endWeek) {
  const key = `${tuningKey(tuning)}:${endWeek}`;
  if (!dataCache.has(key)) {
    dataCache.set(key, await getBtcWeeklyResearch2Data({ tuning, range: { endWeek } }));
  }
  return dataCache.get(key);
}

const tuningSummaries = [];
const allEvents = [];

for (const tuning of TUNINGS) {
  const events = [];
  for (let index = WARMUP_WEEKS; index < weekStarts.length - 1; index += 1) {
    const endWeek = weekStarts[index];
    const nextEndWeek = weekStarts[index + 1];
    const current = await getDataByEndWeek(tuning, endWeek);
    const next = await getDataByEndWeek(tuning, nextEndWeek);
    if (current.loadError || next.loadError) continue;
    const event = buildEvent(current, next, tuning);
    if (!event) continue;
    events.push(event);
  }

  allEvents.push(...events);
  const reverted = events.filter((event) => event.familyReverted).length;
  const continued = events.filter((event) => event.familyContinuedNew).length;

  tuningSummaries.push({
    tuning,
    tuningKey: tuningKey(tuning),
    totalEvents: events.length,
    reverted,
    continued,
    familyReversionRate: events.length ? Number((reverted / events.length).toFixed(4)) : 0,
    familyContinuationRate: events.length ? Number((continued / events.length).toFixed(4)) : 0,
    topRules: summarizeRules(events, buildPredicateMap(), "familyReverted", MIN_RULE_SUPPORT).slice(0, 8),
    transitions: TRANSITION_ORDER.map((transition) => summarizeTransition(events, transition)),
    recentEvents: events.slice(-10),
  });
}

const aggregateTransitions = TRANSITION_ORDER.map((transition) => summarizeTransition(allEvents, transition));
const aggregateRules = summarizeRules(allEvents, buildPredicateMap(), "familyReverted", MIN_RULE_SUPPORT).slice(0, 12);

const summary = {
  generatedAt: new Date().toISOString(),
  warmupWeeks: WARMUP_WEEKS,
  tuningGrid: TUNINGS,
  totalEventsAllTunings: allEvents.length,
  aggregateFamilyReversionRate: allEvents.length
    ? Number((allEvents.filter((event) => event.familyReverted).length / allEvents.length).toFixed(4))
    : 0,
  aggregateFamilyContinuationRate: allEvents.length
    ? Number((allEvents.filter((event) => event.familyContinuedNew).length / allEvents.length).toFixed(4))
    : 0,
  aggregateTopRules: aggregateRules,
  aggregateTransitions,
  tuningSummaries,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const jsonPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-grid-backtest.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRule(rule) {
  return `- ${rule.rule}: precision=${pct(rule.precision)}, support=${rule.support}, wins=${rule.wins}, lift=${rule.lift.toFixed(2)}`;
}

const mdLines = [
  "# Research2 Family Grid Backtest",
  "",
  `生成时间: ${summary.generatedAt}`,
  "",
  `样本预热: ${WARMUP_WEEKS} 周`,
  `总事件数(全部参数合并): ${summary.totalEventsAllTunings}`,
  `全部参数合并后的打回上一个家族概率: ${pct(summary.aggregateFamilyReversionRate)}`,
  `全部参数合并后的延续新家族概率: ${pct(summary.aggregateFamilyContinuationRate)}`,
  "",
  "## 全部参数合并后的 Top Rules",
  ...summary.aggregateTopRules.map(formatRule),
  "",
  "## 全部参数合并后的 6 类变色路径",
  ...summary.aggregateTransitions.map((row) => `- ${row.transitionLabel}: 样本=${row.count}, 打回=${row.reverted}, 打回率=${pct(row.revertedRate)}, 延续新色率=${pct(row.continuedRate)}`),
  "",
  "## 分参数结果",
];

for (const item of tuningSummaries) {
  mdLines.push(`### ${item.tuningKey}`);
  mdLines.push(`- 参数: min=${item.tuning.minSegmentWeeks}, latestMin=${item.tuning.latestSegmentMinWeeks}, penalty=${item.tuning.splitPenalty}, max=${item.tuning.maxSegmentWeeks}`);
  mdLines.push(`- 总事件数: ${item.totalEvents}`);
  mdLines.push(`- 打回上一个家族概率: ${pct(item.familyReversionRate)}`);
  mdLines.push(`- 延续新家族概率: ${pct(item.familyContinuationRate)}`);
  mdLines.push("- 6 类变色路径:");
  for (const row of item.transitions) {
    mdLines.push(`  ${row.transitionLabel}: 样本=${row.count}, 打回率=${pct(row.revertedRate)}, 延续新色率=${pct(row.continuedRate)}`);
  }
  mdLines.push("- Top Rules:");
  mdLines.push(...item.topRules.map(formatRule));
  mdLines.push("");
}

const mdPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-grid-backtest.md");
fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));

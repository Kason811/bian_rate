#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs");

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

process.chdir(WEB_DIR);

const { getBtcWeeklyResearch2Data } = await import("../web/lib/sqlite-workbench-data.ts");

function tuningKey(tuning) {
  return `${tuning.minSegmentWeeks}-${tuning.latestSegmentMinWeeks}-${tuning.splitPenalty}-${tuning.maxSegmentWeeks}`;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function pushMapArray(map, key, value) {
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function summariseTransition(events, transition) {
  const rows = events.filter((event) => event.transition === transition);
  const continued1 = rows.filter((event) => event.continued1).length;
  const continued2 = rows.filter((event) => event.continued2).length;
  const continued3 = rows.filter((event) => event.continued3).length;
  const revertedToPrev = rows.filter((event) => event.revertedToPrevious).length;
  return {
    transition,
    transitionLabel: transitionToChinese(transition),
    count: rows.length,
    continued1Rate: rows.length ? round(continued1 / rows.length, 4) : 0,
    continued2Rate: rows.length ? round(continued2 / rows.length, 4) : 0,
    continued3Rate: rows.length ? round(continued3 / rows.length, 4) : 0,
    revertedToPreviousRate: rows.length ? round(revertedToPrev / rows.length, 4) : 0,
    avgTrendScore: round(mean(rows.map((event) => event.trendScore))),
    avgLeverageScore: round(mean(rows.map((event) => event.leverageScore))),
    avgParticipationScore: round(mean(rows.map((event) => event.participationScore))),
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

const summaryRows = [];
const allEvents = [];

for (const tuning of TUNINGS) {
  const timeframeEvents = new Map();
  const timeframeDatasetYears = new Map();

  for (const dataset of datasetSeeds) {
    const data = await getBtcWeeklyResearch2Data({
      marketType: dataset.marketType,
      timeframe: dataset.timeframe,
      symbol: dataset.symbol,
      tuning,
    });
    if (data.loadError || data.points.length < tuning.latestSegmentMinWeeks + 2) continue;

    const pointIndexByStart = new Map(data.points.map((point, index) => [point.weekStart, index]));
    const pointIndexByEnd = new Map(data.points.map((point, index) => [point.weekEnd, index]));
    const years = Math.max(data.points.length / (dataset.timeframe === "day" ? 365 : dataset.timeframe === "3day" ? 365 / 3 : 52), 0);
    timeframeDatasetYears.set(dataset.timeframe, (timeframeDatasetYears.get(dataset.timeframe) ?? 0) + years);

    for (let segmentIndex = 1; segmentIndex < data.segments.length; segmentIndex += 1) {
      const previousSegment = data.segments[segmentIndex - 1];
      const segment = data.segments[segmentIndex];
      if (segment.family === previousSegment.family) continue;
      if (segment.weeks < tuning.latestSegmentMinWeeks) continue;

      const startIndex = pointIndexByStart.get(segment.start);
      const endIndex = pointIndexByEnd.get(segment.end);
      if (startIndex === undefined || endIndex === undefined) continue;

      const eventIndex = startIndex + tuning.latestSegmentMinWeeks - 1;
      const eventPoint = data.points[eventIndex];
      if (!eventPoint) continue;

      const nextSegment = data.segments[segmentIndex + 1] ?? null;
      const continued1 = endIndex >= eventIndex + 1;
      const continued2 = endIndex >= eventIndex + 2;
      const continued3 = endIndex >= eventIndex + 3;
      const revertedToPrevious = !continued1 && nextSegment?.family === previousSegment.family;

      const event = {
        marketType: dataset.marketType,
        timeframe: dataset.timeframe,
        symbol: dataset.symbol,
        tuningKey: tuningKey(tuning),
        transition: `${previousSegment.family}->${segment.family}`,
        eventBar: eventPoint.weekStart,
        segmentStart: segment.start,
        segmentEnd: segment.end,
        segmentTotalBars: segment.weeks,
        previousFamily: previousSegment.family,
        newFamily: segment.family,
        continued1,
        continued2,
        continued3,
        revertedToPrevious,
        trendScore: eventPoint.trendScore,
        leverageScore: eventPoint.leverageScore,
        participationScore: eventPoint.participationScore,
        volScore: eventPoint.volScore,
        returnZ52: eventPoint.returnZ52,
        fundingRatePct: eventPoint.fundingRatePct,
        avgVolumeM: eventPoint.avgVolumeM,
        adx14: eventPoint.adx14,
        bbwPercentile104: eventPoint.bbwPercentile104,
      };

      pushMapArray(timeframeEvents, dataset.timeframe, event);
      allEvents.push(event);
    }
  }

  for (const timeframe of TIMEFRAMES) {
    const events = timeframeEvents.get(timeframe) ?? [];
    const opportunityPerDatasetYear = (timeframeDatasetYears.get(timeframe) ?? 0) > 0
      ? events.length / (timeframeDatasetYears.get(timeframe) ?? 1)
      : 0;
    const transitionRows = TRANSITION_ORDER
      .map((transition) => summariseTransition(events, transition))
      .sort((left, right) => right.continued1Rate - left.continued1Rate || right.count - left.count);

    summaryRows.push({
      timeframe,
      tuning,
      tuningKey: tuningKey(tuning),
      totalEvents: events.length,
      continued1Rate: events.length ? round(events.filter((event) => event.continued1).length / events.length, 4) : 0,
      continued2Rate: events.length ? round(events.filter((event) => event.continued2).length / events.length, 4) : 0,
      continued3Rate: events.length ? round(events.filter((event) => event.continued3).length / events.length, 4) : 0,
      revertedToPreviousRate: events.length ? round(events.filter((event) => event.revertedToPrevious).length / events.length, 4) : 0,
      avgTrendScore: round(mean(events.map((event) => event.trendScore))),
      avgLeverageScore: round(mean(events.map((event) => event.leverageScore))),
      avgParticipationScore: round(mean(events.map((event) => event.participationScore))),
      avgVolScore: round(mean(events.map((event) => event.volScore))),
      opportunitiesPerDatasetYear: round(opportunityPerDatasetYear, 2),
      topTransitions: transitionRows.slice(0, 3),
      transitions: transitionRows,
    });
  }
}

const bestByTimeframe = TIMEFRAMES.map((timeframe) => {
  const rows = summaryRows
    .filter((row) => row.timeframe === timeframe)
    .sort((left, right) => right.continued1Rate - left.continued1Rate || right.totalEvents - left.totalEvents);
  return {
    timeframe,
    best: rows[0] ?? null,
    runnerUp: rows[1] ?? null,
  };
});

const bestOverall = [...summaryRows].sort((left, right) => {
  if (right.continued1Rate !== left.continued1Rate) return right.continued1Rate - left.continued1Rate;
  return right.totalEvents - left.totalEvents;
})[0] ?? null;

const practicalRows = [...summaryRows].sort((left, right) => {
  const leftScore = left.continued1Rate * Math.log10(left.totalEvents + 10);
  const rightScore = right.continued1Rate * Math.log10(right.totalEvents + 10);
  return rightScore - leftScore;
}).slice(0, 6);

const summary = {
  generatedAt: new Date().toISOString(),
  markets: MARKETS,
  timeframes: TIMEFRAMES,
  tuningGrid: TUNINGS,
  datasetCount: datasetSeeds.length,
  totalEvents: allEvents.length,
  bestOverall,
  bestByTimeframe,
  practicalRows,
  rows: summaryRows,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const jsonPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-continuation-grid.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const mdLines = [
  "# Research2 Family Continuation Grid",
  "",
  `生成时间: ${summary.generatedAt}`,
  `市场范围: ${MARKETS.join(", ")}`,
  `周期范围: ${TIMEFRAMES.join(", ")}`,
  `数据集数量: ${summary.datasetCount}`,
  `总出手机会: ${summary.totalEvents}`,
  "",
  "## 总结",
];

if (bestOverall) {
  mdLines.push(`- 全部组合里，继续 1 根成功率最高的是 ${bestOverall.timeframe} / ${bestOverall.tuningKey}，机会=${bestOverall.totalEvents}，继续1根=${pct(bestOverall.continued1Rate)}，继续2根=${pct(bestOverall.continued2Rate)}，继续3根=${pct(bestOverall.continued3Rate)}，回到上一家族=${pct(bestOverall.revertedToPreviousRate)}`);
}

mdLines.push("- 更实用的组合排序会同时看成功率和机会数，避免只拿少量样本的高命中率。");
mdLines.push("");
mdLines.push("## 各周期最优参数");
for (const row of bestByTimeframe) {
  if (!row.best) continue;
  mdLines.push(`- ${row.timeframe}: 最优 ${row.best.tuningKey}，机会=${row.best.totalEvents}，继续1根=${pct(row.best.continued1Rate)}，每符号年均机会=${row.best.opportunitiesPerDatasetYear.toFixed(2)}`);
  if (row.runnerUp) {
    mdLines.push(`  次优 ${row.runnerUp.tuningKey}，机会=${row.runnerUp.totalEvents}，继续1根=${pct(row.runnerUp.continued1Rate)}，每符号年均机会=${row.runnerUp.opportunitiesPerDatasetYear.toFixed(2)}`);
  }
}

mdLines.push("");
mdLines.push("## 更实用的前 6 组");
for (const row of practicalRows) {
  mdLines.push(`- ${row.timeframe} / ${row.tuningKey}: 机会=${row.totalEvents}，继续1根=${pct(row.continued1Rate)}，继续2根=${pct(row.continued2Rate)}，每符号年均机会=${row.opportunitiesPerDatasetYear.toFixed(2)}，平均趋势/杠杆/参与复合=${row.avgTrendScore.toFixed(2)} / ${row.avgLeverageScore.toFixed(2)} / ${row.avgParticipationScore.toFixed(2)}`);
}

mdLines.push("");
mdLines.push("## 全部组合");
for (const row of summaryRows.sort((left, right) => {
  if (left.timeframe !== right.timeframe) return TIMEFRAMES.indexOf(left.timeframe) - TIMEFRAMES.indexOf(right.timeframe);
  return right.continued1Rate - left.continued1Rate;
})) {
  mdLines.push(`### ${row.timeframe} / ${row.tuningKey}`);
  mdLines.push(`- 机会数: ${row.totalEvents}`);
  mdLines.push(`- 继续1根: ${pct(row.continued1Rate)}`);
  mdLines.push(`- 继续2根: ${pct(row.continued2Rate)}`);
  mdLines.push(`- 继续3根: ${pct(row.continued3Rate)}`);
  mdLines.push(`- 回到上一家族: ${pct(row.revertedToPreviousRate)}`);
  mdLines.push(`- 每符号年均机会: ${row.opportunitiesPerDatasetYear.toFixed(2)}`);
  mdLines.push(`- 平均趋势/杠杆/参与/波动复合: ${row.avgTrendScore.toFixed(2)} / ${row.avgLeverageScore.toFixed(2)} / ${row.avgParticipationScore.toFixed(2)} / ${row.avgVolScore.toFixed(2)}`);
  mdLines.push("- 最强转换:");
  for (const transition of row.topTransitions) {
    mdLines.push(`  ${transition.transitionLabel}: 样本=${transition.count}，继续1根=${pct(transition.continued1Rate)}，继续2根=${pct(transition.continued2Rate)}，回到上一家族=${pct(transition.revertedToPreviousRate)}`);
  }
  mdLines.push("");
}

const mdPath = path.join(OUTPUT_DIR, "2026-04-07-research2-family-continuation-grid.md");
fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));

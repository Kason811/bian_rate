#!/usr/bin/env node

import path from "node:path";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(path.join(ROOT_DIR, "web"));

const { getBtcWeeklyResearch2Data } = await import("../web/lib/sqlite-workbench-data.ts");

const MARKETS = ["usdtm", "coinm"];
const TIMEFRAMES = ["day", "3day", "week"];
const TUNING = { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 };
const WARMUP_BARS = 60;
const HORIZONS = [1, 2, 3];

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
}

function std(values) {
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length || 1);
  return Math.sqrt(variance) || 1;
}

function zscore(values) {
  const avg = mean(values);
  const deviation = std(values);
  return values.map((value) => (value - avg) / deviation);
}

function aucRank(rows) {
  const sorted = [...rows].sort((left, right) => left.score - right.score);
  let rankSum = 0;
  let positive = 0;
  let negative = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].target) {
      rankSum += index + 1;
      positive += 1;
    } else {
      negative += 1;
    }
  }
  if (!positive || !negative) return 0.5;
  return (rankSum - ((positive * (positive + 1)) / 2)) / (positive * negative);
}

function topLift(rows, quantile = 0.2) {
  if (!rows.length) return { lift: 1, hitRate: 0, baseline: 0, support: 0 };
  const baseline = rows.filter((row) => row.target).length / rows.length;
  const take = Math.max(10, Math.floor(rows.length * quantile));
  const top = [...rows].sort((left, right) => right.score - left.score).slice(0, take);
  const hitRate = top.filter((row) => row.target).length / top.length;
  return {
    lift: baseline ? hitRate / baseline : 1,
    hitRate,
    baseline,
    support: top.length,
  };
}

function nextFamilyChangeWithin(points, index, horizon) {
  const currentFamily = points[index].family;
  for (let step = 1; step <= horizon; step += 1) {
    const nextPoint = points[index + step];
    if (!nextPoint) break;
    if (nextPoint.family !== currentFamily) return true;
  }
  return false;
}

function firstDifferentFutureFamily(points, index, horizon) {
  const currentFamily = points[index].family;
  for (let step = 1; step <= horizon; step += 1) {
    const nextPoint = points[index + step];
    if (!nextPoint) break;
    if (nextPoint.family !== currentFamily) return nextPoint.family;
  }
  return null;
}

function addScoreRows(bucketMap, key, rows) {
  const existing = bucketMap.get(key) ?? [];
  existing.push(...rows);
  bucketMap.set(key, existing);
}

const datasets = [];
for (const timeframe of TIMEFRAMES) {
  for (const marketType of MARKETS) {
    const seed = await getBtcWeeklyResearch2Data({ marketType, timeframe, symbol: "BTC", tuning: TUNING });
    for (const symbol of seed.availableSymbols) {
      const data = await getBtcWeeklyResearch2Data({ marketType, timeframe, symbol, tuning: TUNING });
      if (data.points.length < 120) continue;
      datasets.push({ marketType, timeframe, symbol, points: data.points });
    }
  }
}

const switchMetricRows = new Map();
const directionMetricRows = new Map();
const transitionSignalRows = new Map();

for (const dataset of datasets) {
  const points = dataset.points;
  const fundingZ = zscore(points.map((point) => point.fundingRatePct));
  const volumeZ = zscore(points.map((point) => point.avgVolumeM));
  const adxZ = zscore(points.map((point) => point.adx14));
  const returnZZ = zscore(points.map((point) => point.returnZ52));
  const bbwCentered = points.map((point) => (point.bbwPercentile104 - 50) / 50);
  const bbwZ = zscore(bbwCentered);
  const emaGap = points.map((point) => (point.ema21 ? (point.closePrice - point.ema21) / point.ema21 : 0));
  const smaGap = points.map((point) => (point.sma200 ? (point.closePrice - point.sma200) / point.sma200 : 0));
  const emaGapZ = zscore(emaGap);
  const priceTrendComposite = points.map((_, index) => (emaGapZ[index] * 0.55) + (returnZZ[index] * 0.25) + (adxZ[index] * 0.2));
  const volatilityComposite = points.map((_, index) => (bbwZ[index] * 0.7) + (adxZ[index] * 0.3));
  const leverageComposite = points.map((_, index) => (fundingZ[index] * 0.65) + (returnZZ[index] * 0.35));
  const participationComposite = points.map((_, index) => (volumeZ[index] * 0.7) + (adxZ[index] * 0.3));

  const switchMetrics = {
    absReturnZ: points.map((point) => Math.abs(point.returnZ52)),
    adx14: points.map((point) => point.adx14),
    bbwPct: points.map((point) => point.bbwPercentile104),
    absFundingZ: fundingZ.map((value) => Math.abs(value)),
    volumeZ,
    absEmaGap: emaGap.map((value) => Math.abs(value)),
    absSmaGap: smaGap.map((value) => Math.abs(value)),
    priceTrendCompositeAbs: priceTrendComposite.map((value) => Math.abs(value)),
    volatilityComposite,
    leverageCompositeAbs: leverageComposite.map((value) => Math.abs(value)),
    participationComposite,
  };

  const directionMetrics = {
    fundingAlignNext: fundingZ,
    returnZAlignNext: points.map((point) => point.returnZ52),
    emaGapAlignNext: emaGap,
    smaGapAlignNext: smaGap,
    priceTrendAlignNext: priceTrendComposite,
    leverageAlignNext: leverageComposite,
  };
  const transitionMetrics = {
    fundingZ,
    volumeZ,
    adxZ,
    bbwZ,
    returnZZ,
    emaGap,
    smaGap,
    priceTrendComposite,
    leverageComposite,
    participationComposite,
  };

  for (const horizon of HORIZONS) {
    for (const [metric, values] of Object.entries(switchMetrics)) {
      const rows = [];
      for (let index = WARMUP_BARS; index < points.length - horizon; index += 1) {
        rows.push({
          score: values[index],
          target: nextFamilyChangeWithin(points, index, horizon) ? 1 : 0,
        });
      }
      addScoreRows(switchMetricRows, `${horizon}:${metric}`, rows);
    }

    for (const [metric, values] of Object.entries(directionMetrics)) {
      const rows = [];
      for (let index = WARMUP_BARS; index < points.length - horizon; index += 1) {
        const nextFamily = firstDifferentFutureFamily(points, index, horizon);
        if (!nextFamily || nextFamily === "Sideways") continue;
        const direction = nextFamily === "Bull" ? 1 : -1;
        rows.push({ score: values[index] * direction, target: 1 });
      }
      addScoreRows(directionMetricRows, `${horizon}:${metric}`, rows);
    }
  }

  for (let index = WARMUP_BARS + 1; index < points.length; index += 1) {
    const previousFamily = points[index - 1].family;
    const currentFamily = points[index].family;
    if (previousFamily === currentFamily) continue;
    const key = `${previousFamily}->${currentFamily}`;
    const rows = transitionSignalRows.get(key) ?? [];
    rows.push({
      fundingZ: transitionMetrics.fundingZ[index - 1],
      volumeZ: transitionMetrics.volumeZ[index - 1],
      adxZ: transitionMetrics.adxZ[index - 1],
      bbwZ: transitionMetrics.bbwZ[index - 1],
      returnZZ: transitionMetrics.returnZZ[index - 1],
      emaGap: transitionMetrics.emaGap[index - 1],
      smaGap: transitionMetrics.smaGap[index - 1],
      priceTrendComposite: transitionMetrics.priceTrendComposite[index - 1],
      leverageComposite: transitionMetrics.leverageComposite[index - 1],
      participationComposite: transitionMetrics.participationComposite[index - 1],
    });
    transitionSignalRows.set(key, rows);
  }
}

const futureChange = {};
for (const horizon of HORIZONS) {
  const rows = [];
  for (const [key, values] of switchMetricRows.entries()) {
    const [bucketHorizon, metric] = key.split(":");
    if (Number(bucketHorizon) !== horizon) continue;
    const auc = aucRank(values);
    const lift = topLift(values, 0.2);
    rows.push({
      metric,
      auc: Number(auc.toFixed(3)),
      top20Lift: Number(lift.lift.toFixed(2)),
      baseline: Number(lift.baseline.toFixed(3)),
      top20HitRate: Number(lift.hitRate.toFixed(3)),
      support: values.length,
    });
  }
  rows.sort((left, right) => right.auc - left.auc || right.top20Lift - left.top20Lift);
  futureChange[horizon] = rows.slice(0, 10);
}

const futureDirection = {};
for (const horizon of HORIZONS) {
  const rows = [];
  for (const [key, values] of directionMetricRows.entries()) {
    const [bucketHorizon, metric] = key.split(":");
    if (Number(bucketHorizon) !== horizon) continue;
    const hitIfUseSign = values.filter((row) => row.score > 0).length / (values.length || 1);
    rows.push({
      metric,
      signHitRate: Number(hitIfUseSign.toFixed(3)),
      meanAlignedScore: Number(mean(values.map((row) => row.score)).toFixed(3)),
      support: values.length,
    });
  }
  rows.sort((left, right) => right.signHitRate - left.signHitRate || right.meanAlignedScore - left.meanAlignedScore);
  futureDirection[horizon] = rows;
}

const transitionPreSignal = {};
for (const [transition, rows] of transitionSignalRows.entries()) {
  transitionPreSignal[transition] = {
    count: rows.length,
    fundingZ: Number(mean(rows.map((row) => row.fundingZ)).toFixed(3)),
    volumeZ: Number(mean(rows.map((row) => row.volumeZ)).toFixed(3)),
    adxZ: Number(mean(rows.map((row) => row.adxZ)).toFixed(3)),
    bbwZ: Number(mean(rows.map((row) => row.bbwZ)).toFixed(3)),
    returnZZ: Number(mean(rows.map((row) => row.returnZZ)).toFixed(3)),
    emaGap: Number(mean(rows.map((row) => row.emaGap)).toFixed(4)),
    smaGap: Number(mean(rows.map((row) => row.smaGap)).toFixed(4)),
    priceTrendComposite: Number(mean(rows.map((row) => row.priceTrendComposite)).toFixed(3)),
    leverageComposite: Number(mean(rows.map((row) => row.leverageComposite)).toFixed(3)),
    participationComposite: Number(mean(rows.map((row) => row.participationComposite)).toFixed(3)),
  };
}

console.log(JSON.stringify({
  tuning: TUNING,
  datasetCount: datasets.length,
  futureChange,
  futureDirection,
  transitionPreSignal,
}, null, 2));

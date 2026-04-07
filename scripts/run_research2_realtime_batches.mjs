#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs", "research2-realtime-batches");
const LOG_PATH = path.join(ROOT_DIR, "run", "research2-realtime-batches.log");

process.chdir(WEB_DIR);

const { getBtcWeeklyResearch2Data } = await import("../web/lib/sqlite-workbench-data.ts");

const TUNINGS = [
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 7, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 8, latestSegmentMinWeeks: 4, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 3, splitPenalty: 7.8, maxSegmentWeeks: 40 },
  { minSegmentWeeks: 6, latestSegmentMinWeeks: 2, splitPenalty: 7.8, maxSegmentWeeks: 40 },
];
const TIMEFRAMES = ["day", "3day", "week"];
const TRANSITION_ORDER = [
  "Bull->Sideways",
  "Bear->Sideways",
  "Sideways->Bull",
  "Sideways->Bear",
  "Bull->Bear",
  "Bear->Bull",
];

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function aggregateRows(rows) {
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
  return { summaryRows, bestByTimeframe, bestOverall };
}

function buildAggregateMarkdown(summary, title) {
  const lines = [
    `# ${title}`,
    "",
    `生成时间: ${summary.generatedAt}`,
    `模式: ${summary.mode}`,
    `总事件数: ${summary.totalEvents}`,
    "",
  ];
  if (summary.bestOverall) {
    lines.push(`- 全部组合最佳: ${summary.bestOverall.timeframe} / ${summary.bestOverall.tuningKey}, 机会=${summary.bestOverall.totalEvents}, 延续率=${pct(summary.bestOverall.familyContinuationRate)}, 打回率=${pct(summary.bestOverall.familyReversionRate)}`);
    lines.push("");
  }
  for (const item of summary.bestByTimeframe) {
    if (!item.best) continue;
    lines.push(`## ${item.timeframe}`);
    lines.push(`- 最优: ${item.best.tuningKey}, 机会=${item.best.totalEvents}, 延续率=${pct(item.best.familyContinuationRate)}, 打回率=${pct(item.best.familyReversionRate)}`);
    if (item.runnerUp) {
      lines.push(`- 次优: ${item.runnerUp.tuningKey}, 机会=${item.runnerUp.totalEvents}, 延续率=${pct(item.runnerUp.familyContinuationRate)}, 打回率=${pct(item.runnerUp.familyReversionRate)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function logLine(message) {
  console.log(message);
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function refreshAggregate(completedSymbols, aggregateJsonPath, aggregateMdPath) {
  const allRows = [];
  for (const completedSymbol of completedSymbols) {
    const symbolFile = path.join(OUTPUT_DIR, `${completedSymbol}.json`);
    if (!fs.existsSync(symbolFile)) continue;
    const payload = JSON.parse(fs.readFileSync(symbolFile, "utf8"));
    allRows.push(...(payload.rows ?? []));
  }
  const aggregate = aggregateRows(allRows);
  const aggregatePayload = {
    generatedAt: new Date().toISOString(),
    mode: "realtime-window-rebuild-candidates-batched-parallel",
    completedSymbols,
    totalEvents: allRows.length,
    ...aggregate,
    rows: allRows,
  };
  writeJson(aggregateJsonPath, aggregatePayload);
  fs.writeFileSync(aggregateMdPath, buildAggregateMarkdown(aggregatePayload, "Research2 Realtime Batches Aggregate"), "utf8");
}

ensureDir(OUTPUT_DIR);
ensureDir(path.dirname(LOG_PATH));

const progressPath = path.join(OUTPUT_DIR, "progress.json");
const aggregateJsonPath = path.join(OUTPUT_DIR, "aggregate.json");
const aggregateMdPath = path.join(OUTPUT_DIR, "aggregate.md");

const seed = await getBtcWeeklyResearch2Data({
  marketType: "usdtm",
  timeframe: "week",
  symbol: "BTC",
  tuning: TUNINGS[0],
});
if (seed.loadError) {
  throw new Error(`Failed to discover symbols: ${seed.loadError}`);
}
const symbols = seed.availableSymbols;

const progress = loadJson(progressPath, {
  startedAt: new Date().toISOString(),
  currentSymbols: [],
  completedSymbols: [],
  failedSymbols: [],
  updatedAt: null,
});

const completedSet = new Set(
  symbols.filter((symbol) => fs.existsSync(path.join(OUTPUT_DIR, `${symbol}.json`))).concat(progress.completedSymbols ?? []),
);
const failedSet = new Set(progress.failedSymbols ?? []);
const remaining = symbols.filter((symbol) => !completedSet.has(symbol));

progress.completedSymbols = [...completedSet].sort();
progress.currentSymbols = [];
progress.currentSymbol = null;
progress.updatedAt = new Date().toISOString();
writeJson(progressPath, progress);
refreshAggregate(progress.completedSymbols, aggregateJsonPath, aggregateMdPath);

if (!remaining.length) {
  logLine(`[complete] all symbols already processed: ${progress.completedSymbols.length}/${symbols.length}`);
  process.exit(0);
}

const envWorkers = Number(process.env.RESEARCH2_BATCH_WORKERS || "");
const envWorkerHeapMb = Number(process.env.RESEARCH2_WORKER_MAX_OLD_SPACE_MB || "");
const cpuDefault = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2) || 1));
const workerCount = Number.isFinite(envWorkers) && envWorkers > 0 ? Math.floor(envWorkers) : cpuDefault;
const workerHeapMb = Number.isFinite(envWorkerHeapMb) && envWorkerHeapMb > 0 ? Math.floor(envWorkerHeapMb) : 6144;

logLine(`[resume] completed=${progress.completedSymbols.length}/${symbols.length} remaining=${remaining.length} workers=${workerCount}`);

let cursor = 0;
let running = 0;

await new Promise((resolve, reject) => {
  const launchNext = () => {
    while (running < workerCount && cursor < remaining.length) {
      const symbol = remaining[cursor++];
      running += 1;
      progress.currentSymbols = [...new Set([...(progress.currentSymbols ?? []), symbol])];
      progress.currentSymbol = progress.currentSymbols[0] ?? null;
      progress.updatedAt = new Date().toISOString();
      writeJson(progressPath, progress);
      logLine(`[start] ${symbol}`);

      const child = spawn(process.execPath, [`--max-old-space-size=${workerHeapMb}`, "scripts/run_research2_realtime_symbol.mjs", symbol], {
        cwd: ROOT_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        running -= 1;
        failedSet.add(symbol);
        progress.currentSymbols = (progress.currentSymbols ?? []).filter((item) => item !== symbol);
        progress.currentSymbol = progress.currentSymbols[0] ?? null;
        progress.failedSymbols = [...failedSet].sort();
        progress.updatedAt = new Date().toISOString();
        writeJson(progressPath, progress);
        logLine(`[error] ${symbol} spawn_failed=${error.message}`);
        reject(error);
      });

      child.on("close", (code) => {
        running -= 1;
        progress.currentSymbols = (progress.currentSymbols ?? []).filter((item) => item !== symbol);
        progress.currentSymbol = progress.currentSymbols[0] ?? null;
        if (code === 0 && fs.existsSync(path.join(OUTPUT_DIR, `${symbol}.json`))) {
          completedSet.add(symbol);
          progress.completedSymbols = [...completedSet].sort();
          progress.updatedAt = new Date().toISOString();
          writeJson(progressPath, progress);
          refreshAggregate(progress.completedSymbols, aggregateJsonPath, aggregateMdPath);
          let events = "?";
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").filter(Boolean).join("\n"));
            events = parsed.events;
          } catch {}
          logLine(`[done] ${symbol} events=${events} completed=${progress.completedSymbols.length}/${symbols.length}`);
        } else {
          failedSet.add(symbol);
          progress.failedSymbols = [...failedSet].sort();
          progress.updatedAt = new Date().toISOString();
          writeJson(progressPath, progress);
          const detail = stderr.trim() || stdout.trim() || `exit=${code}`;
          logLine(`[failed] ${symbol} ${detail}`);
        }

        if (cursor >= remaining.length && running === 0) {
          logLine(`[complete] processed=${progress.completedSymbols.length}/${symbols.length} failed=${progress.failedSymbols?.length ?? 0}`);
          resolve();
          return;
        }
        launchNext();
      });
    }
  };

  launchNext();
});

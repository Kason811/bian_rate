"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  getRateTrend,
  getRateValue,
  getVolumeTrend,
  getVolumeValue,
  type MarketSymbol,
  type Timeframe,
  type WorkbenchData,
} from "@/lib/workbench-data";

type ViewKey = "rates" | "volume" | "combined" | "heatmap";
type CandidateTier = "priority" | "watch" | "exclude";
type RateWindowKey = "currentMonth" | "previousMonth" | "previous3Months" | "previous6Months" | "previous12Months";
type RateTableSortKey =
  | "symbol"
  | "prevMonthYearly"
  | "prev3MonthsYearly"
  | "prev6MonthsYearly"
  | "prev12MonthsYearly"
  | "prev24MonthsYearly"
  | "positiveDays30"
  | "positiveDays90"
  | "positiveDays180"
  | "avg30dVolumeM"
  | "avg90dVolumeM"
  | "avg365dVolumeM"
  | "compositeScore";
type ScoredSymbol = MarketSymbol & {
  combinedScore: number;
  currentRate: number;
  currentVolume: number;
  tier: CandidateTier;
  reason: string;
};
type RateTableRow = {
  row: MarketSymbol;
  metrics: ReturnType<typeof getAnnualizedMetrics>;
  compositeScore: number;
};

const timeframeItems: { key: Timeframe; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
];

const chartPalette = ["#2563eb", "#0f766e", "#d97706", "#db2777", "#7c3aed", "#0891b2"];
const rateWindowItems: { key: RateWindowKey; label: string; hint: string }[] = [
  { key: "currentMonth", label: "本月维度", hint: "本月累计费率" },
  { key: "previousMonth", label: "上月维度", hint: "上月总费率" },
  { key: "previous3Months", label: "上3个月维度", hint: "不含本月，近 3 个完整月总费率" },
  { key: "previous6Months", label: "上6个月维度", hint: "不含本月，近 6 个完整月总费率" },
  { key: "previous12Months", label: "上12个月维度", hint: "不含本月，近 12 个完整月总费率" },
];

function fmtPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function fmtVol(value: number) {
  return `${value.toFixed(1)}M`;
}

function parseDateText(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatRangeLabel(start: Date, end: Date) {
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日至${end.getDate()}日`;
    }
    return `${start.getFullYear()}年${start.getMonth() + 1}月至${end.getMonth() + 1}月`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月至${end.getFullYear()}年${end.getMonth() + 1}月`;
}

function diffDaysInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function viewTitle(view: ViewKey) {
  return view === "rates" ? "费率总览" : view === "volume" ? "成交量观察" : view === "combined" ? "联合筛选" : "热力图";
}

function tierLabel(tier: CandidateTier) {
  return tier === "priority" ? "优先候选" : tier === "watch" ? "可观察" : "排除";
}

function tierTone(tier: CandidateTier) {
  return tier === "priority" ? "bg-emerald-50 text-emerald-700" : tier === "watch" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
}

function rateText(value: number) {
  return value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-slate-500";
}

function getWindowRateValue(symbol: MarketSymbol, window: RateWindowKey) {
  if (window === "currentMonth") return symbol.rateMonthPct;
  if (window === "previousMonth") return symbol.ratePrevMonthPct;
  if (window === "previous3Months") return symbol.ratePrev3MonthsPct;
  if (window === "previous6Months") return symbol.ratePrev6MonthsPct;
  return symbol.ratePrev12MonthsPct;
}

function getWindowVolumeValue(symbol: MarketSymbol, window: RateWindowKey) {
  if (window === "currentMonth") return symbol.monthAvgDailyVolumeM;
  if (window === "previousMonth") return symbol.prevMonthAvgDailyVolumeM;
  if (window === "previous3Months") return symbol.prev3MonthsAvgDailyVolumeM;
  if (window === "previous6Months") return symbol.prev6MonthsAvgDailyVolumeM;
  return symbol.prev12MonthsAvgDailyVolumeM;
}

function getWindowRangeInfo(window: RateWindowKey, latestDateText: string) {
  const latestDate = parseDateText(latestDateText);
  const currentMonthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  const previousMonthStart = new Date(latestDate.getFullYear(), latestDate.getMonth() - 1, 1);
  const previousMonthEnd = new Date(latestDate.getFullYear(), latestDate.getMonth(), 0);

  if (window === "currentMonth") {
    return {
      label: formatRangeLabel(currentMonthStart, latestDate),
      dayCount: diffDaysInclusive(currentMonthStart, latestDate),
    };
  }

  if (window === "previousMonth") {
    return {
      label: formatMonthLabel(previousMonthStart),
      dayCount: diffDaysInclusive(previousMonthStart, previousMonthEnd),
    };
  }

  const monthSpan = window === "previous3Months" ? 3 : window === "previous6Months" ? 6 : 12;
  const rangeStart = new Date(latestDate.getFullYear(), latestDate.getMonth() - monthSpan, 1);
  return {
    label: formatRangeLabel(rangeStart, previousMonthEnd),
    dayCount: diffDaysInclusive(rangeStart, previousMonthEnd),
  };
}

function getWindowAnnualizedRate(symbol: MarketSymbol, window: RateWindowKey, latestDateText: string) {
  const rawValue = getWindowRateValue(symbol, window);
  const { dayCount } = getWindowRangeInfo(window, latestDateText);
  if (!dayCount) return 0;
  return (rawValue / dayCount) * 365;
}

function topRankHighlightClass(score: number) {
  if (score >= 40) return "bg-emerald-200 border border-emerald-300";
  if (score >= 28) return "bg-emerald-100 border border-emerald-200";
  if (score >= 16) return "bg-emerald-50 border border-emerald-100";
  return "bg-white";
}

function negativeTopRankHighlightClass(score: number) {
  if (score >= 40) return "bg-rose-200 border border-rose-300";
  if (score >= 28) return "bg-rose-100 border border-rose-200";
  if (score >= 16) return "bg-rose-50 border border-rose-100";
  return "bg-white";
}

function rateRankHeatClass(rank: number, total: number, value: number) {
  const ratio = total > 1 ? rank / (total - 1) : 0;
  if (value < 0) {
    if (ratio >= 0.75) return "bg-rose-200 text-rose-900";
    if (ratio >= 0.5) return "bg-rose-100 text-rose-800";
    if (ratio >= 0.25) return "bg-rose-50 text-rose-700";
    return "bg-slate-100 text-slate-600";
  }
  if (value === 0) return "bg-slate-100 text-slate-600";
  if (ratio >= 0.75) return "bg-emerald-200 text-emerald-900";
  if (ratio >= 0.5) return "bg-emerald-100 text-emerald-800";
  if (ratio >= 0.25) return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

function volumeRankHeatClass(rank: number, total: number) {
  const ratio = total > 1 ? rank / (total - 1) : 0;
  if (ratio >= 0.75) return "bg-sky-200 text-sky-900";
  if (ratio >= 0.5) return "bg-sky-100 text-sky-800";
  if (ratio >= 0.25) return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

function buildRankMap(values: { symbol: string; value: number }[]) {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  return new Map(sorted.map((entry, index) => [entry.symbol, { rank: index, total: sorted.length, value: entry.value }]));
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function clamp01(value: number) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function scoreFromRank(rank: number, total: number) {
  if (total <= 1) return 0.5;
  return rank / (total - 1);
}

function scoreFromLogVolume(value: number, universe: number[]) {
  const transformed = universe.map((item) => Math.log1p(Math.max(item, 0)));
  const low = percentile(transformed, 0.2);
  const high = percentile(transformed, 0.9);
  const current = Math.log1p(Math.max(value, 0));
  if (high <= low) return current > low ? 1 : 0;
  return clamp01((current - low) / (high - low));
}

function rateTableValue(entry: RateTableRow, key: RateTableSortKey) {
  if (key === "symbol") return entry.row.symbol;
  if (key === "prevMonthYearly") return entry.metrics.prevMonthYearly;
  if (key === "prev3MonthsYearly") return entry.metrics.prev3MonthsYearly;
  if (key === "prev6MonthsYearly") return entry.metrics.prev6MonthsYearly;
  if (key === "prev12MonthsYearly") return entry.metrics.prev12MonthsYearly;
  if (key === "prev24MonthsYearly") return entry.metrics.prev24MonthsYearly;
  if (key === "positiveDays30") return entry.row.positiveDays30;
  if (key === "positiveDays90") return entry.row.positiveDays90;
  if (key === "positiveDays180") return entry.row.positiveDays180;
  if (key === "avg30dVolumeM") return entry.row.avg30dVolumeM;
  if (key === "avg90dVolumeM") return entry.row.avg90dVolumeM;
  if (key === "avg365dVolumeM") return entry.row.avg365dVolumeM;
  return entry.compositeScore;
}

function getAnnualizedMetrics(symbol: MarketSymbol) {
  return {
    prevMonthYearly: symbol.ratePrevMonthPct * 12,
    prev3MonthsYearly: symbol.ratePrev3MonthsPct * 4,
    prev6MonthsYearly: symbol.ratePrev6MonthsPct * 2,
    prev12MonthsYearly: symbol.ratePrev12MonthsPct,
    prev24MonthsYearly: symbol.ratePrev24MonthsPct / 2,
  };
}

function getComparisonWindow(timeframe: Timeframe): RateWindowKey {
  if (timeframe === "day") return "previousMonth";
  if (timeframe === "week") return "previous3Months";
  return "previous12Months";
}

function buildRateTable(symbols: MarketSymbol[], timeframe: Timeframe) {
  return [...symbols].sort((a, b) => getRateValue(b, timeframe) - getRateValue(a, timeframe));
}

function buildWindowRateTable(symbols: MarketSymbol[], window: RateWindowKey) {
  return [...symbols].sort((a, b) => getWindowRateValue(b, window) - getWindowRateValue(a, window));
}

function buildNegativeWindowRateTable(symbols: MarketSymbol[], window: RateWindowKey) {
  return [...symbols].sort((a, b) => getWindowRateValue(a, window) - getWindowRateValue(b, window));
}

function buildVolumeTable(symbols: MarketSymbol[], timeframe: Timeframe) {
  return [...symbols].sort((a, b) => getVolumeValue(b, timeframe) - getVolumeValue(a, timeframe));
}

function buildCombinedScore(symbol: MarketSymbol, timeframe: Timeframe, minVolume: number) {
  const rate = getRateValue(symbol, timeframe);
  const volume = getVolumeValue(symbol, timeframe);
  const rateStrength = Math.max(rate, 0) * 700;
  const stability = Math.max(0, 24 - symbol.rateVolatility30Pct * 450);
  const persistence = (symbol.positiveDays30 / 30) * 24;
  const liquidity = Math.min(volume * 1.2, 24);
  const penalty = volume < minVolume ? 18 : 0;
  return Math.max(0, Math.min(100, Math.round(rateStrength + stability + persistence + liquidity - penalty)));
}

function classifySymbol(symbol: MarketSymbol, timeframe: Timeframe, minVolume: number): ScoredSymbol {
  const currentRate = getRateValue(symbol, timeframe);
  const currentVolume = getVolumeValue(symbol, timeframe);
  const combinedScore = buildCombinedScore(symbol, timeframe, minVolume);

  let tier: CandidateTier = "watch";
  let reason = "费率和成交量都在中间区域，适合继续观察。";

  if (currentVolume < minVolume) {
    tier = "exclude";
    reason = "成交量低于门槛，先排除容量风险。";
  } else if (currentRate <= 0 && symbol.avg30dRatePct <= 0) {
    tier = "exclude";
    reason = "当前与近 30 日费率都不强，不进入优先池。";
  } else if (currentRate > 0 && symbol.avg30dRatePct > 0 && symbol.positiveDays30 >= 20) {
    tier = "priority";
    reason = "当前费率为正，近 30 日保持正偏，且容量达到门槛。";
  } else if (currentRate <= 0) {
    reason = "短期转弱，但中期费率还没完全坏掉。";
  } else if (symbol.positiveDays30 < 16) {
    reason = "费率可看，但连续性一般，需要确认是否只是短期脉冲。";
  }

  return {
    ...symbol,
    combinedScore,
    currentRate,
    currentVolume,
    tier,
    reason,
  };
}

function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      {title || hint ? (
        <div className="mb-4">
          {title ? <h3 className="text-base font-semibold text-slate-900">{title}</h3> : null}
          {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-3 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function WindowMetricCard({
  window,
  leader,
  positiveCount,
  totalCount,
  lowLiquidityCount,
}: {
  window: { key: RateWindowKey; label: string; hint: string };
  leader?: MarketSymbol;
  positiveCount: number;
  totalCount: number;
  lowLiquidityCount: number;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-5">
      <div className="text-sm text-slate-500">{window.label}</div>
      <div className="mt-4 space-y-4">
        <div>
          <div className="text-xs text-slate-500">领先币</div>
          <div className="mt-1 text-xl font-semibold">{leader ? leader.symbol : "-"}</div>
          <div className={`mt-1 text-sm ${leader ? rateText(getWindowRateValue(leader, window.key)) : "text-slate-500"}`}>
            {leader ? fmtPct(getWindowRateValue(leader, window.key)) : "暂无数据"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">正费率数量</div>
          <div className="mt-1 text-xl font-semibold">{positiveCount} / {totalCount}</div>
          <div className="mt-1 text-xs text-slate-500">当前维度下仍保持正费率的币种数量。</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">低流动性数量</div>
          <div className="mt-1 text-xl font-semibold">{lowLiquidityCount}</div>
          <div className="mt-1 text-xs text-slate-500">当前维度月日均成交量低于 5M，默认不进重点池。</div>
        </div>
      </div>
    </div>
  );
}

function WindowTopList({
  window,
  rows,
  heatScores,
  latestDateText,
  titleMode = "positive",
}: {
  window: { key: RateWindowKey; label: string; hint: string };
  rows: MarketSymbol[];
  heatScores: Map<string, number>;
  latestDateText: string;
  titleMode?: "positive" | "negative";
}) {
  const rangeInfo = getWindowRangeInfo(window.key, latestDateText);
  return (
    <div className={`rounded-[22px] border p-4 ${titleMode === "negative" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-sm font-medium text-slate-900">{window.label}</div>
      <div className="mt-1 text-xs text-slate-500">{rangeInfo.label}</div>
      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div
            key={`${window.key}-${row.symbol}`}
            className={`group relative flex items-center justify-between rounded-xl px-3 py-2 ${titleMode === "negative" ? negativeTopRankHighlightClass(heatScores.get(row.symbol) ?? 0) : topRankHighlightClass(heatScores.get(row.symbol) ?? 0)}`}
          >
            <div className="flex items-center gap-3">
              <span className="w-5 text-xs text-slate-400">{index + 1}</span>
              <span className="font-medium text-slate-900">{row.symbol}</span>
            </div>
            <span className={`text-sm font-medium ${rateText(getWindowRateValue(row, window.key))}`}>{fmtPct(getWindowRateValue(row, window.key))}</span>
            <div className="pointer-events-none absolute left-3 top-full z-20 mt-2 hidden w-52 rounded-xl border border-slate-200 bg-white p-3 shadow-lg group-hover:block">
              <div className="text-sm font-semibold text-slate-900">{row.symbol}</div>
              <div className="mt-2 text-xs text-slate-500">{window.label}</div>
              <div className="mt-1 text-xs text-slate-500">{rangeInfo.label}</div>
              <div className="mt-1 text-sm text-slate-700">年化：{fmtPct(getWindowAnnualizedRate(row, window.key, latestDateText))}</div>
              <div className="mt-1 text-sm text-slate-700">日均成交量：{fmtVol(getWindowVolumeValue(row, window.key))}</div>
              <div className="mt-1 text-xs text-slate-500">{titleMode === "positive" ? "上榜热度分" : "负榜热度分"}：{heatScores.get(row.symbol) ?? 0}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapNode(props: { depth?: number; x?: number; y?: number; width?: number; height?: number; name?: string; rate?: number }) {
  if ((props.depth ?? 0) < 1) return <g />;
  const rate = props.rate ?? 0;
  const fill = rate > 0.03 ? "#047857" : rate > 0 ? "#10b981" : rate < -0.03 ? "#b91c1c" : "#fb7185";
  const showText = (props.width ?? 0) > 42 && (props.height ?? 0) > 34;

  return (
    <g>
      <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} stroke="#fff" strokeWidth={2} />
      {showText ? (
        <>
          <text x={(props.x ?? 0) + (props.width ?? 0) / 2} y={(props.y ?? 0) + (props.height ?? 0) / 2 - 4} fill="#fff" textAnchor="middle" fontSize={14} fontWeight="bold">
            {props.name}
          </text>
          <text x={(props.x ?? 0) + (props.width ?? 0) / 2} y={(props.y ?? 0) + (props.height ?? 0) / 2 + 12} fill="#fff" textAnchor="middle" fontSize={12}>
            {fmtPct(rate)}
          </text>
        </>
      ) : null}
    </g>
  );
}

function TierSummary({ rows }: { rows: ScoredSymbol[] }) {
  const groups: CandidateTier[] = ["priority", "watch", "exclude"];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {groups.map((tier) => (
        <div key={tier} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${tierTone(tier)}`}>{tierLabel(tier)}</div>
          <div className="mt-3 text-2xl font-semibold text-slate-900">{rows.filter((row) => row.tier === tier).length}</div>
          <div className="mt-1 text-sm text-slate-500">{tier === "priority" ? "费率强且容量达标。" : tier === "watch" ? "费率可看，但还要确认。" : "先规避容量或费率问题。"}</div>
        </div>
      ))}
    </div>
  );
}

function FocusList({ title, rows, emptyText }: { title: string; rows: ScoredSymbol[]; emptyText: string }) {
  return (
    <Card title={title}>
      <div className="space-y-3">
        {rows.length ? rows.map((row) => (
          <div key={row.symbol} className="rounded-[20px] border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">{row.symbol}</div>
                <div className="mt-1 text-sm text-slate-500">{row.reason}</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${tierTone(row.tier)}`}>{tierLabel(row.tier)}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-slate-500">当前费率</div>
                <div className={`mt-1 font-medium ${rateText(row.currentRate)}`}>{fmtPct(row.currentRate)}</div>
              </div>
              <div>
                <div className="text-slate-500">成交量</div>
                <div className="mt-1 font-medium text-slate-900">{fmtVol(row.currentVolume)}</div>
              </div>
              <div>
                <div className="text-slate-500">联合分数</div>
                <div className="mt-1 font-medium text-slate-900">{row.combinedScore}</div>
              </div>
            </div>
          </div>
        )) : <div className="rounded-[20px] border border-dashed border-slate-300 p-4 text-sm text-slate-500">{emptyText}</div>}
      </div>
    </Card>
  );
}

function WorkbenchShell({
  data,
  initialView,
  timeframe,
  setTimeframe,
  children,
}: {
  data: WorkbenchData;
  initialView: ViewKey;
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  children: React.ReactNode;
}) {
  const overviewWindows = rateWindowItems.map((window) => {
    const ranked = buildWindowRateTable(data.symbols, window.key);
    return {
      window,
      leader: ranked[0],
      positiveCount: data.symbols.filter((item) => getWindowRateValue(item, window.key) > 0).length,
      lowLiquidityCount: data.symbols.filter((item) => getWindowVolumeValue(item, window.key) < 5).length,
    };
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e0f2fe,_#f8fafc_42%,_#f8fafc)] text-slate-900">
      <div className="mx-auto max-w-[1480px] px-4 py-5 md:px-6">
        <main className="min-w-0">
            <header className="mb-6 rounded-[30px] border border-slate-200 bg-white/92 p-6 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <div className="text-sm text-slate-500">Analysis Mode</div>
                    <h1 className="mt-1 text-3xl font-semibold tracking-tight">{viewTitle(initialView)}</h1>
                  </div>
                  <div className="text-xs text-slate-500">
                    Data: {data.sourceLabel}
                    <br />
                    Updated: {data.updatedAtLabel}
                  </div>
                </div>

                {data.loadError ? (
                  <div className="rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    SQLite 数据暂不可用：{data.loadError}
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-5">
                  {overviewWindows.map((entry) => (
                    <WindowMetricCard
                      key={entry.window.key}
                      window={entry.window}
                      leader={entry.leader}
                      positiveCount={entry.positiveCount}
                      totalCount={data.symbols.length}
                      lowLiquidityCount={entry.lowLiquidityCount}
                    />
                  ))}
                </div>
              </div>
            </header>

            {children}
        </main>
      </div>
    </div>
  );
}

function RateOverview({
  symbols,
  timeframe,
  setTimeframe,
  latestDateText,
}: {
  symbols: MarketSymbol[];
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  latestDateText: string;
}) {
  const ranked = useMemo(() => buildRateTable(symbols, timeframe), [symbols, timeframe]);
  const [selected, setSelected] = useState<string[]>([]);
  const [minVolume, setMinVolume] = useState<number>(0);
  const [rankingMinVolume, setRankingMinVolume] = useState<number>(0);
  const [negativeRankingMinVolume, setNegativeRankingMinVolume] = useState<number>(0);
  const [sortKey, setSortKey] = useState<RateTableSortKey>("prev12MonthsYearly");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const filtered = ranked.filter((item) => item.monthAvgDailyVolumeM >= minVolume);
  const comparisonWindow = getComparisonWindow(timeframe);
  const comparisonRanked = buildWindowRateTable(filtered, comparisonWindow);
  const defaultSelectedSymbols = comparisonRanked.slice(0, 5).map((item) => item.symbol);
  const windowLeaders = rateWindowItems.map((window) => ({
    window,
    rows: buildWindowRateTable(
      symbols.filter((item) => getWindowVolumeValue(item, window.key) >= rankingMinVolume),
      window.key,
    ).slice(0, 10),
  }));
  const negativeWindowLeaders = rateWindowItems.map((window) => ({
    window,
    rows: buildNegativeWindowRateTable(
      symbols.filter((item) => getWindowVolumeValue(item, window.key) >= negativeRankingMinVolume),
      window.key,
    ).slice(0, 10),
  }));
  const rankingHeatScores = useMemo(() => {
    const scoreMap = new Map<string, number>();
    for (const { rows } of windowLeaders) {
      rows.forEach((row, index) => {
        const rankScore = 11 - (index + 1);
        const current = scoreMap.get(row.symbol) ?? 0;
        scoreMap.set(row.symbol, current + rankScore);
      });
    }
    return scoreMap;
  }, [windowLeaders]);
  const negativeRankingHeatScores = useMemo(() => {
    const scoreMap = new Map<string, number>();
    for (const { rows } of negativeWindowLeaders) {
      rows.forEach((row, index) => {
        const rankScore = 11 - (index + 1);
        const current = scoreMap.get(row.symbol) ?? 0;
        scoreMap.set(row.symbol, current + rankScore);
      });
    }
    return scoreMap;
  }, [negativeWindowLeaders]);

  useEffect(() => {
    setSelected(defaultSelectedSymbols);
  }, [comparisonWindow, minVolume, symbols]);

  const chartAnchor = comparisonRanked[0] ?? filtered[0];
  const chartRows = (chartAnchor ? getRateTrend(chartAnchor, timeframe) : []).map((point, index) => {
    const row: Record<string, string | number> = { label: point.label };
    selected.forEach((symbol) => {
      const target = filtered.find((item) => item.symbol === symbol) ?? ranked.find((item) => item.symbol === symbol);
      if (target) row[symbol] = getRateTrend(target, timeframe)[index]?.value ?? 0;
    });
    return row;
  });

  const scored = filtered.map((item) => classifySymbol(item, timeframe, minVolume));
  const prevMonthRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prevMonthYearly })));
  const prev3MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev3MonthsYearly })));
  const prev6MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev6MonthsYearly })));
  const prev12MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev12MonthsYearly })));
  const prev24MonthsRankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: getAnnualizedMetrics(item).prev24MonthsYearly })));
  const positive30RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays30 })));
  const positive90RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays90 })));
  const positive180RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.positiveDays180 })));
  const volume30RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg30dVolumeM })));
  const volume90RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg90dVolumeM })));
  const volume365RankMap = buildRankMap(symbols.map((item) => ({ symbol: item.symbol, value: item.avg365dVolumeM })));
  const annualVolumeUniverse = symbols.map((item) => item.avg365dVolumeM);
  const priorityRows = symbols
    .map((row) => {
      const metrics = getAnnualizedMetrics(row);
      const annualizedScore =
        scoreFromRank(prevMonthRankMap.get(row.symbol)?.rank ?? 0, prevMonthRankMap.get(row.symbol)?.total ?? 1) * 0.1 +
        scoreFromRank(prev3MonthsRankMap.get(row.symbol)?.rank ?? 0, prev3MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.15 +
        scoreFromRank(prev6MonthsRankMap.get(row.symbol)?.rank ?? 0, prev6MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.2 +
        scoreFromRank(prev12MonthsRankMap.get(row.symbol)?.rank ?? 0, prev12MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.3 +
        scoreFromRank(prev24MonthsRankMap.get(row.symbol)?.rank ?? 0, prev24MonthsRankMap.get(row.symbol)?.total ?? 1) * 0.25;
      const positiveScore =
        scoreFromRank(positive30RankMap.get(row.symbol)?.rank ?? 0, positive30RankMap.get(row.symbol)?.total ?? 1) * 0.25 +
        scoreFromRank(positive90RankMap.get(row.symbol)?.rank ?? 0, positive90RankMap.get(row.symbol)?.total ?? 1) * 0.35 +
        scoreFromRank(positive180RankMap.get(row.symbol)?.rank ?? 0, positive180RankMap.get(row.symbol)?.total ?? 1) * 0.4;
      const volumeScore =
        scoreFromLogVolume(row.avg30dVolumeM, annualVolumeUniverse) * 0.2 +
        scoreFromLogVolume(row.avg90dVolumeM, annualVolumeUniverse) * 0.3 +
        scoreFromLogVolume(row.avg365dVolumeM, annualVolumeUniverse) * 0.5;

      return {
        row,
        metrics,
        compositeScore: Math.round((annualizedScore * 0.6 + positiveScore * 0.25 + volumeScore * 0.15) * 100),
      };
    })
    .sort((a, b) => {
      const left = rateTableValue(a, sortKey);
      const right = rateTableValue(b, sortKey);
      const factor = sortDirection === "desc" ? -1 : 1;
      if (typeof left === "string" && typeof right === "string") {
        return left.localeCompare(right) * factor;
      }
      return (((left as number) ?? 0) - ((right as number) ?? 0)) * factor;
    });

  const toggleSort = (key: RateTableSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "symbol" ? "asc" : "desc");
  };

  return (
    <div className="space-y-6">
      <Card title="费率长期对比" hint="日维度默认按上月排名取前 3，周维度默认按上 3 个月排名取前 3，月维度默认按上 12 个月排名取前 3。">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {timeframeItems.map((item) => (
              <button key={item.key} type="button" onClick={() => setTimeframe(item.key)} className={`rounded-full px-4 py-2 text-sm ${timeframe === item.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                {item.label}维度
              </button>
            ))}
          </div>
          <label className="text-sm text-slate-600">
            最低月均成交量
            <select value={String(minVolume)} onChange={(event) => setMinVolume(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="0">不限</option>
              <option value="1">1M+</option>
              <option value="2">2M+</option>
              <option value="3">3M+</option>
              <option value="5">5M+</option>
              <option value="10">10M+</option>
              <option value="30">30M+</option>
            </select>
          </label>
          <div className="text-sm text-slate-500">
            当前排序基准：
            {comparisonWindow === "previousMonth" ? "上月维度" : comparisonWindow === "previous3Months" ? "上3个月维度" : "上12个月维度"}
          </div>
          <button
            type="button"
            onClick={() => setSelected(defaultSelectedSymbols)}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            恢复默认前5
          </button>
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
              <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${Number(value).toFixed(3)}%`} />
              <ReferenceLine y={0} stroke="#64748b" strokeDasharray="6 4" />
              <Tooltip formatter={(value) => `${Number(value).toFixed(3)}%`} />
              {selected.map((symbol, index) => (
                <Line key={symbol} type="monotone" dataKey={symbol} stroke={chartPalette[index % chartPalette.length]} dot={false} strokeWidth={2.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {comparisonRanked.slice(0, 12).map((item) => {
            const active = selected.includes(item.symbol);
            const activeIndex = selected.findIndex((symbol) => symbol === item.symbol);
            const color = active ? chartPalette[activeIndex % chartPalette.length] : "#cbd5e1";
            return (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(item.symbol) ? current.filter((entry) => entry !== item.symbol) : [...current, item.symbol],
                    )
                  }
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${active ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}
                >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                {item.symbol}
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">费率排名 Top 10</h3>
            <label className="text-sm text-slate-600">
              最低日均成交量
              <select value={String(rankingMinVolume)} onChange={(event) => setRankingMinVolume(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <option value="0">不限</option>
                <option value="1">1M+</option>
                <option value="2">2M+</option>
                <option value="3">3M+</option>
                <option value="5">5M+</option>
                <option value="10">10M+</option>
                <option value="30">30M+</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
              {windowLeaders.map(({ window, rows }) => (
                <WindowTopList key={window.key} window={window} rows={rows} heatScores={rankingHeatScores} latestDateText={latestDateText} />
              ))}
          </div>
        </Card>
      </div>

      <div>
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">负费率排名 Top 10</h3>
            <label className="text-sm text-slate-600">
              最低日均成交量
              <select value={String(negativeRankingMinVolume)} onChange={(event) => setNegativeRankingMinVolume(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <option value="0">不限</option>
                <option value="1">1M+</option>
                <option value="2">2M+</option>
                <option value="3">3M+</option>
                <option value="5">5M+</option>
                <option value="10">10M+</option>
                <option value="30">30M+</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
              {negativeWindowLeaders.map(({ window, rows }) => (
                <WindowTopList key={`negative-${window.key}`} window={window} rows={rows} heatScores={negativeRankingHeatScores} latestDateText={latestDateText} titleMode="negative" />
              ))}
          </div>
        </Card>
      </div>

      <Card title="费率优先表" hint="默认按上12个月年化排序，点击列头可切换升降序。">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-center text-[13px] leading-5">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="w-[84px] py-2.5">
                  <button type="button" onClick={() => toggleSort("symbol")} className="font-medium">
                    币种 {sortKey === "symbol" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[88px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prevMonthYearly")} className="font-medium">
                    上月年化 {sortKey === "prevMonthYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev3MonthsYearly")} className="font-medium">
                    上3个月年化 {sortKey === "prev3MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev6MonthsYearly")} className="font-medium">
                    上6个月年化 {sortKey === "prev6MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev12MonthsYearly")} className="font-medium">
                    上12个月年化 {sortKey === "prev12MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("prev24MonthsYearly")} className="font-medium">
                    上24个月年化 {sortKey === "prev24MonthsYearly" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays30")} className="font-medium">
                    30日正费天数 {sortKey === "positiveDays30" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[96px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays90")} className="font-medium">
                    90日正费天数 {sortKey === "positiveDays90" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[100px] py-2.5">
                  <button type="button" onClick={() => toggleSort("positiveDays180")} className="font-medium">
                    180日正费天数 {sortKey === "positiveDays180" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg30dVolumeM")} className="font-medium">
                    30日均成交量 {sortKey === "avg30dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg90dVolumeM")} className="font-medium">
                    90日均成交量 {sortKey === "avg90dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[92px] py-2.5">
                  <button type="button" onClick={() => toggleSort("avg365dVolumeM")} className="font-medium">
                    年日均成交量 {sortKey === "avg365dVolumeM" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
                <th className="w-[74px] py-2.5">
                  <button type="button" onClick={() => toggleSort("compositeScore")} className="font-medium">
                    分数 {sortKey === "compositeScore" ? (sortDirection === "desc" ? "↓" : "↑") : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map(({ row, metrics, compositeScore }) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-2.5 font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prevMonthRankMap.get(row.symbol)?.rank ?? 0, prevMonthRankMap.get(row.symbol)?.total ?? 1, metrics.prevMonthYearly)}`}>
                      {fmtPct(metrics.prevMonthYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev3MonthsRankMap.get(row.symbol)?.rank ?? 0, prev3MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev3MonthsYearly)}`}>
                      {fmtPct(metrics.prev3MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev6MonthsRankMap.get(row.symbol)?.rank ?? 0, prev6MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev6MonthsYearly)}`}>
                      {fmtPct(metrics.prev6MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev12MonthsRankMap.get(row.symbol)?.rank ?? 0, prev12MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev12MonthsYearly)}`}>
                      {fmtPct(metrics.prev12MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[80px] justify-center rounded-full px-2 py-1 text-xs font-medium ${rateRankHeatClass(prev24MonthsRankMap.get(row.symbol)?.rank ?? 0, prev24MonthsRankMap.get(row.symbol)?.total ?? 1, metrics.prev24MonthsYearly)}`}>
                      {fmtPct(metrics.prev24MonthsYearly)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive30RankMap.get(row.symbol)?.rank ?? 0, positive30RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays30}/30
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[74px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive90RankMap.get(row.symbol)?.rank ?? 0, positive90RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays90}/90
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[82px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(positive180RankMap.get(row.symbol)?.rank ?? 0, positive180RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {row.positiveDays180}/180
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume30RankMap.get(row.symbol)?.rank ?? 0, volume30RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg30dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume90RankMap.get(row.symbol)?.rank ?? 0, volume90RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg90dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[68px] justify-center rounded-full px-2 py-1 text-xs font-medium ${volumeRankHeatClass(volume365RankMap.get(row.symbol)?.rank ?? 0, volume365RankMap.get(row.symbol)?.total ?? 1)}`}>
                      {fmtVol(row.avg365dVolumeM)}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex min-w-[54px] justify-center rounded-full px-2 py-1 text-xs font-semibold ${compositeScore >= 75 ? "bg-slate-900 text-white" : compositeScore >= 55 ? "bg-slate-700 text-white" : compositeScore >= 35 ? "bg-slate-200 text-slate-900" : "bg-slate-100 text-slate-600"}`}>
                      {compositeScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function VolumeView({ symbols, timeframe }: { symbols: MarketSymbol[]; timeframe: Timeframe }) {
  const ranked = useMemo(() => buildVolumeTable(symbols, timeframe), [symbols, timeframe]);
  const [selectedSymbol, setSelectedSymbol] = useState(ranked[0]?.symbol ?? "");
  const focus = ranked.find((item) => item.symbol === selectedSymbol) ?? ranked[0];
  const trendRows = focus ? getVolumeTrend(focus, timeframe) : [];
  const topRows = ranked.slice(0, 12).map((row) => ({
    symbol: row.symbol,
    volume: getVolumeValue(row, timeframe),
    rate: getRateValue(row, timeframe),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="最高成交量" value={ranked[0] ? `${ranked[0].symbol} ${fmtVol(getVolumeValue(ranked[0], timeframe))}` : "-"} hint="成交量只负责确认容量，不代表费率优先。" />
        <Kpi label="高量但负费率" value={ranked.find((item) => getRateValue(item, timeframe) < 0) ? `${ranked.find((item) => getRateValue(item, timeframe) < 0)?.symbol} ${fmtPct(getRateValue(ranked.find((item) => getRateValue(item, timeframe) < 0)!, timeframe))}` : "-"} hint="像 BTC/ETH 这种情况需要单独识别，不自动优先。" />
        <Kpi label="低量排除线" value="5M" hint="超低流动性币种默认不进入重点观察。" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card title="成交量排名" hint="当前时间维度下的成交量排序，颜色仍用费率方向辅助判断。">
          <div className="h-[360px] w-full">
            <ResponsiveContainer>
              <BarChart data={topRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="symbol" tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${value}M`} />
                <Tooltip />
                <Bar dataKey="volume" radius={[6, 6, 0, 0]}>
                  {topRows.map((row) => (
                    <Cell key={row.symbol} fill={row.rate > 0 ? "#0f766e" : "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="单币成交量走势" hint="先看容量曲线，再回到费率页判断值不值得做。">
          <div className="mb-4 flex flex-wrap gap-2">
            {ranked.slice(0, 12).map((item) => (
              <button key={item.symbol} type="button" onClick={() => setSelectedSymbol(item.symbol)} className={`rounded-full border px-3 py-1 text-sm ${focus?.symbol === item.symbol ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                {item.symbol}
              </button>
            ))}
          </div>
          <div className="h-[360px] w-full">
            <ResponsiveContainer>
              <LineChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 12 }} tickFormatter={(value) => `${value}M`} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="流动性分层" hint="这页不判断值不值得做，只判断容量够不够。">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">超高流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 100).length}</div>
            <div className="mt-1 text-sm text-slate-500">100M 以上。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">高流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 30 && getVolumeValue(row, timeframe) < 100).length}</div>
            <div className="mt-1 text-sm text-slate-500">30M 到 100M。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">中等流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) >= 5 && getVolumeValue(row, timeframe) < 30).length}</div>
            <div className="mt-1 text-sm text-slate-500">5M 到 30M。</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="text-sm text-slate-500">低流动性</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{ranked.filter((row) => getVolumeValue(row, timeframe) < 5).length}</div>
            <div className="mt-1 text-sm text-slate-500">低于 5M。</div>
          </div>
        </div>
      </Card>

      <Card title="成交量观察表" hint="这页只判断容量，不替代费率判断。">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">币种</th>
                <th className="py-3 text-right">当前成交量</th>
                <th className="py-3 text-right">当前费率</th>
                <th className="py-3 text-right">30日均费率</th>
                <th className="py-3 text-right">30日正费天数</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-3 text-right text-slate-600">{fmtVol(getVolumeValue(row, timeframe))}</td>
                  <td className={`py-3 text-right ${rateText(getRateValue(row, timeframe))}`}>{fmtPct(getRateValue(row, timeframe))}</td>
                  <td className="py-3 text-right text-slate-600">{fmtPct(row.avg30dRatePct)}</td>
                  <td className="py-3 text-right text-slate-600">{row.positiveDays30}/30</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CombinedView({ symbols, timeframe }: { symbols: MarketSymbol[]; timeframe: Timeframe }) {
  const [minVolume, setMinVolume] = useState(5);
  const [positiveOnly, setPositiveOnly] = useState(false);

  const scored = useMemo(() => {
    return symbols
      .map((symbol) => classifySymbol(symbol, timeframe, minVolume))
      .filter((row) => (positiveOnly ? row.currentRate > 0 : true))
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }, [symbols, timeframe, minVolume, positiveOnly]);

  const scatterRows = scored.map((row) => ({
    symbol: row.symbol,
    x: row.currentVolume,
    y: row.currentRate,
    z: Math.max(row.combinedScore, 10),
    tier: row.tier,
  }));

  const priorityRows = scored.filter((row) => row.tier === "priority");
  const watchRows = scored.filter((row) => row.tier === "watch");
  const excludeRows = scored.filter((row) => row.tier === "exclude");

  return (
    <div className="space-y-6">
      <Card title="联合筛选规则" hint="费率优先，成交量只做过滤和风险确认。">
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-slate-600">
            最低成交量
            <select value={String(minVolume)} onChange={(event) => setMinVolume(Number(event.target.value))} className="ml-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              <option value="0">不限</option>
              <option value="1">1M+</option>
              <option value="5">5M+</option>
              <option value="10">10M+</option>
              <option value="30">30M+</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={positiveOnly} onChange={(event) => setPositiveOnly(event.target.checked)} />
            只看当前正费率
          </label>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="优先候选数" value={`${priorityRows.length}`} hint="当前费率为正、近 30 日保持正偏且容量达标。" />
        <Kpi label="当前榜首" value={scored[0] ? `${scored[0].symbol} ${scored[0].combinedScore}` : "-"} hint="先看费率，再看持续性和容量。" />
        <Kpi label="排除数量" value={`${excludeRows.length}`} hint="不直接消失，而是明确显示排除原因。" />
      </div>

      <TierSummary rows={scored} />

      <Card title="费率 + 成交量联合分布" hint="X 轴是成交量，Y 轴是费率，点大小是联合分数。">
        <div className="h-[390px] w-full">
          <ResponsiveContainer>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="x" name="volume" unit="M" tick={{ fill: "#64748b", fontSize: 12 }} />
              <YAxis type="number" dataKey="y" name="rate" unit="%" tick={{ fill: "#64748b", fontSize: 12 }} />
              <ZAxis type="number" dataKey="z" range={[80, 360]} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <ReferenceLine x={minVolume} stroke="#94a3b8" strokeDasharray="4 4" />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Scatter data={scatterRows}>
                {scatterRows.map((row) => (
                  <Cell key={row.symbol} fill={row.tier === "priority" ? "#0f766e" : row.tier === "watch" ? "#d97706" : "#94a3b8"} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <FocusList title="优先候选" rows={priorityRows.slice(0, 4)} emptyText="当前条件下没有进入优先池的币。" />
        <FocusList title="可观察" rows={watchRows.slice(0, 4)} emptyText="当前没有需要额外观察的币。" />
        <FocusList title="排除原因" rows={excludeRows.slice(0, 4)} emptyText="当前没有被排除的币。" />
      </div>

      <Card title="联合候选表" hint="不做空表。即使不满足，也保留并写明原因。">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">币种</th>
                <th className="py-3">状态</th>
                <th className="py-3 text-right">当前费率</th>
                <th className="py-3 text-right">当前成交量</th>
                <th className="py-3 text-right">30日波动</th>
                <th className="py-3 text-right">正费天数</th>
                <th className="py-3 text-right">联合分数</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((row) => (
                <tr key={row.symbol} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{row.symbol}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${tierTone(row.tier)}`}>{tierLabel(row.tier)}</span>
                  </td>
                  <td className={`py-3 text-right ${rateText(row.currentRate)}`}>{fmtPct(row.currentRate)}</td>
                  <td className="py-3 text-right text-slate-600">{fmtVol(row.currentVolume)}</td>
                  <td className="py-3 text-right text-slate-600">{fmtPct(row.rateVolatility30Pct)}</td>
                  <td className="py-3 text-right text-slate-600">{row.positiveDays30}/30</td>
                  <td className="py-3 text-right font-semibold text-slate-900">{row.combinedScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function HeatmapView({ symbols, timeframe }: { symbols: MarketSymbol[]; timeframe: Timeframe }) {
  const ranked = buildRateTable(symbols, timeframe);
  const byVolume = buildVolumeTable(symbols, timeframe);
  const heatmapData = [
    {
      name: "Market",
      children: symbols.map((item) => ({
        name: item.symbol,
        size: Math.max(getVolumeValue(item, timeframe), 0.1),
        rate: getRateValue(item, timeframe),
      })),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="最强色块" value={ranked[0] ? `${ranked[0].symbol} ${fmtPct(getRateValue(ranked[0], timeframe))}` : "-"} hint="颜色代表费率方向和强弱。" />
        <Kpi label="最大色块" value={byVolume[0] ? `${byVolume[0].symbol} ${fmtVol(getVolumeValue(byVolume[0], timeframe))}` : "-"} hint="面积代表容量，不代表优先级。" />
        <Kpi label="用途" value="辅助扫盘" hint="热力图只用于快速扫全市场，不替代费率总览和联合筛选。" />
      </div>

      <Card title="市场热力图" hint="面积看成交量，颜色看费率。先保留作为辅助扫盘工具。">
        <div className="h-[540px] w-full">
          <ResponsiveContainer>
            <Treemap data={heatmapData} dataKey="size" aspectRatio={4 / 3} stroke="#fff" content={<HeatmapNode />}>
              <Tooltip />
            </Treemap>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

export default function MarketWorkbench({ data, initialView }: { data: WorkbenchData; initialView: ViewKey }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("month");

  return (
    <WorkbenchShell data={data} initialView={initialView} timeframe={timeframe} setTimeframe={setTimeframe}>
      {initialView === "rates" ? <RateOverview symbols={data.symbols} timeframe={timeframe} setTimeframe={setTimeframe} latestDateText={data.updatedAtLabel} /> : null}
      {initialView === "volume" ? <VolumeView symbols={data.symbols} timeframe={timeframe} /> : null}
      {initialView === "combined" ? <CombinedView symbols={data.symbols} timeframe={timeframe} /> : null}
      {initialView === "heatmap" ? <HeatmapView symbols={data.symbols} timeframe={timeframe} /> : null}
    </WorkbenchShell>
  );
}

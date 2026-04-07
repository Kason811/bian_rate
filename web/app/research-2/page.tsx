import MarketWorkbench from "@/components/market-workbench";
import { getResearch2Defaults } from "@/lib/research2-defaults";
import { getBtcWeeklyResearch2Data, getWorkbenchData } from "@/lib/sqlite-workbench-data";
import type { ResearchMarketType, ResearchTimeframe } from "@/lib/workbench-data";

export const dynamic = "force-dynamic";

function parseIntParam(value: string | string[] | undefined, fallback: number) {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(text ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value: string | string[] | undefined, fallback: number) {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseFloat(text ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnumParam<T extends string>(value: string | string[] | undefined, fallback: T, allowed: readonly T[]) {
  const text = Array.isArray(value) ? value[0] : value;
  return allowed.includes((text ?? "") as T) ? ((text ?? "") as T) : fallback;
}

function parseSymbolParam(value: string | string[] | undefined, fallback: string) {
  const text = Array.isArray(value) ? value[0] : value;
  const normalized = (text ?? fallback).trim().toUpperCase();
  return /^[A-Z0-9_:-]{2,30}$/.test(normalized) ? normalized : fallback;
}

export default async function Research2Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const serverDefaults = getResearch2Defaults();
  const marketType = parseEnumParam<ResearchMarketType>(params.market, "usdtm", ["coinm", "usdtm"]);
  const timeframe = parseEnumParam<ResearchTimeframe>(params.timeframe, "3day", ["week", "3day", "day", "8h", "4h"]);
  const symbol = parseSymbolParam(params.symbol, "ETH");
  const tuning = {
    minSegmentWeeks: parseIntParam(params.minWeeks, serverDefaults.tuning.minWeeks),
    latestSegmentMinWeeks: parseIntParam(params.latestMinWeeks, serverDefaults.tuning.latestMinWeeks),
    splitPenalty: parseFloatParam(params.splitPenalty, serverDefaults.tuning.splitPenalty),
    maxSegmentWeeks: parseIntParam(params.maxWeeks, serverDefaults.tuning.maxWeeks),
  };
  const indicatorSettings = {
    emaPeriod: parseIntParam(params.emaPeriod, serverDefaults.indicator.emaPeriod),
    smaPeriod: parseIntParam(params.smaPeriod, serverDefaults.indicator.smaPeriod),
    adxPeriod: parseIntParam(params.adxPeriod, serverDefaults.indicator.adxPeriod),
    adxTrendLevel: parseIntParam(params.adxTrendLevel, serverDefaults.indicator.adxTrendLevel),
    rsiPeriod: parseIntParam(params.rsiPeriod, serverDefaults.indicator.rsiPeriod),
    rsiUpper: parseIntParam(params.rsiUpper, serverDefaults.indicator.rsiUpper),
    rsiLower: parseIntParam(params.rsiLower, serverDefaults.indicator.rsiLower),
    bbPeriod: parseIntParam(params.bbPeriod, serverDefaults.indicator.bbPeriod),
    bbStdDev: parseFloatParam(params.bbStdDev, serverDefaults.indicator.bbStdDev),
    returnZPeriod: parseIntParam(params.returnZPeriod, serverDefaults.indicator.returnZPeriod),
    returnUpper: parseFloatParam(params.returnUpper, serverDefaults.indicator.returnUpper),
    returnLower: parseFloatParam(params.returnLower, serverDefaults.indicator.returnLower),
    bbwPercentileWindow: parseIntParam(params.bbwWindow, serverDefaults.indicator.bbwWindow),
    bbwHigh: parseIntParam(params.bbwHigh, serverDefaults.indicator.bbwHigh),
    bbwLow: parseIntParam(params.bbwLow, serverDefaults.indicator.bbwLow),
  };
  const [data, research2Data] = await Promise.all([
    Promise.resolve(getWorkbenchData()),
    getBtcWeeklyResearch2Data({ marketType, symbol, timeframe, tuning, indicatorSettings }),
  ]);
  return <MarketWorkbench data={data} initialView="research2" research2Data={research2Data} />;
}

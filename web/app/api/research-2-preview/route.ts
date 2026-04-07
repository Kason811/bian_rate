import { NextRequest, NextResponse } from "next/server";
import { getBtcWeeklyResearch2Data } from "@/lib/sqlite-workbench-data";
import { getResearch2Defaults } from "@/lib/research2-defaults";
import type { ResearchMarketType, ResearchTimeframe } from "@/lib/workbench-data";

function parseIntParam(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value: string | null, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnumParam<T extends string>(value: string | null, fallback: T, allowed: readonly T[]) {
  return allowed.includes((value ?? "") as T) ? ((value ?? "") as T) : fallback;
}

function parseSymbolParam(value: string | null, fallback: string) {
  const normalized = (value ?? fallback).trim().toUpperCase();
  return /^[A-Z0-9_:-]{2,30}$/.test(normalized) ? normalized : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const serverDefaults = getResearch2Defaults();
  const data = await getBtcWeeklyResearch2Data({
    marketType: parseEnumParam<ResearchMarketType>(searchParams.get("market"), "coinm", ["coinm", "usdtm"]),
    symbol: parseSymbolParam(searchParams.get("symbol"), "BTC"),
    timeframe: parseEnumParam<ResearchTimeframe>(searchParams.get("timeframe"), "week", ["week", "3day", "day", "8h", "4h"]),
    tuning: {
      minSegmentWeeks: parseIntParam(searchParams.get("minWeeks"), serverDefaults.tuning.minWeeks),
      latestSegmentMinWeeks: parseIntParam(searchParams.get("latestMinWeeks"), serverDefaults.tuning.latestMinWeeks),
      splitPenalty: parseFloatParam(searchParams.get("splitPenalty"), 7.8),
      maxSegmentWeeks: parseIntParam(searchParams.get("maxWeeks"), serverDefaults.tuning.maxWeeks),
    },
    indicatorSettings: {
      emaPeriod: parseIntParam(searchParams.get("emaPeriod"), serverDefaults.indicator.emaPeriod),
      smaPeriod: parseIntParam(searchParams.get("smaPeriod"), serverDefaults.indicator.smaPeriod),
      adxPeriod: parseIntParam(searchParams.get("adxPeriod"), serverDefaults.indicator.adxPeriod),
      adxTrendLevel: parseIntParam(searchParams.get("adxTrendLevel"), serverDefaults.indicator.adxTrendLevel),
      rsiPeriod: parseIntParam(searchParams.get("rsiPeriod"), serverDefaults.indicator.rsiPeriod),
      rsiUpper: parseIntParam(searchParams.get("rsiUpper"), serverDefaults.indicator.rsiUpper),
      rsiLower: parseIntParam(searchParams.get("rsiLower"), serverDefaults.indicator.rsiLower),
      bbPeriod: parseIntParam(searchParams.get("bbPeriod"), serverDefaults.indicator.bbPeriod),
      bbStdDev: parseFloatParam(searchParams.get("bbStdDev"), serverDefaults.indicator.bbStdDev),
      returnZPeriod: parseIntParam(searchParams.get("returnZPeriod"), serverDefaults.indicator.returnZPeriod),
      returnUpper: parseFloatParam(searchParams.get("returnUpper"), serverDefaults.indicator.returnUpper),
      returnLower: parseFloatParam(searchParams.get("returnLower"), serverDefaults.indicator.returnLower),
      bbwPercentileWindow: parseIntParam(searchParams.get("bbwWindow"), serverDefaults.indicator.bbwWindow),
      bbwHigh: parseIntParam(searchParams.get("bbwHigh"), serverDefaults.indicator.bbwHigh),
      bbwLow: parseIntParam(searchParams.get("bbwLow"), serverDefaults.indicator.bbwLow),
    },
    range: {
      startWeek: searchParams.get("startWeek") ?? undefined,
      endWeek: searchParams.get("endWeek") ?? undefined,
    },
  });

  return NextResponse.json(data);
}

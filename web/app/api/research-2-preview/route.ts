import { NextRequest, NextResponse } from "next/server";
import { getBtcWeeklyResearch2Data } from "@/lib/sqlite-workbench-data";

function parseIntParam(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value: string | null, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const data = await getBtcWeeklyResearch2Data({
    tuning: {
      minSegmentWeeks: parseIntParam(searchParams.get("minWeeks"), 5),
      latestSegmentMinWeeks: parseIntParam(searchParams.get("latestMinWeeks"), 5),
      splitPenalty: parseFloatParam(searchParams.get("splitPenalty"), 7.8),
      maxSegmentWeeks: parseIntParam(searchParams.get("maxWeeks"), 28),
    },
    indicatorSettings: {
      emaPeriod: parseIntParam(searchParams.get("emaPeriod"), 21),
      smaPeriod: parseIntParam(searchParams.get("smaPeriod"), 200),
      adxPeriod: parseIntParam(searchParams.get("adxPeriod"), 14),
      adxTrendLevel: parseIntParam(searchParams.get("adxTrendLevel"), 25),
      rsiPeriod: parseIntParam(searchParams.get("rsiPeriod"), 14),
      rsiUpper: parseIntParam(searchParams.get("rsiUpper"), 80),
      rsiLower: parseIntParam(searchParams.get("rsiLower"), 20),
      bbPeriod: parseIntParam(searchParams.get("bbPeriod"), 20),
      bbStdDev: parseFloatParam(searchParams.get("bbStdDev"), 2),
      returnZPeriod: parseIntParam(searchParams.get("returnZPeriod"), 52),
      returnUpper: parseFloatParam(searchParams.get("returnUpper"), 2),
      returnLower: parseFloatParam(searchParams.get("returnLower"), -2),
      bbwPercentileWindow: parseIntParam(searchParams.get("bbwWindow"), 104),
      bbwHigh: parseIntParam(searchParams.get("bbwHigh"), 70),
      bbwLow: parseIntParam(searchParams.get("bbwLow"), 30),
    },
    range: {
      startWeek: searchParams.get("startWeek") ?? undefined,
      endWeek: searchParams.get("endWeek") ?? undefined,
    },
  });

  return NextResponse.json(data);
}

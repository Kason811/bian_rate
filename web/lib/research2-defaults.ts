import fs from "node:fs";
import path from "node:path";

export const SYSTEM_RESEARCH2_DEFAULTS = {
  tuning: {
    minWeeks: 5,
    latestMinWeeks: 5,
    splitPenalty: 7.8,
    maxWeeks: 28,
  },
  indicator: {
    emaPeriod: 21,
    smaPeriod: 200,
    adxPeriod: 14,
    adxTrendLevel: 25,
    rsiPeriod: 14,
    rsiUpper: 80,
    rsiLower: 20,
    bbPeriod: 20,
    bbStdDev: 2,
    returnZPeriod: 52,
    returnUpper: 2,
    returnLower: -2,
    bbwWindow: 104,
    bbwHigh: 70,
    bbwLow: 30,
  },
} as const;

export type Research2Defaults = {
  tuning: { [K in keyof typeof SYSTEM_RESEARCH2_DEFAULTS.tuning]: number };
  indicator: { [K in keyof typeof SYSTEM_RESEARCH2_DEFAULTS.indicator]: number };
};

type Research2DefaultsScope = keyof Research2Defaults;

function defaultsPath() {
  return path.resolve(process.cwd(), "lib", "research-2-defaults.json");
}

function coerceNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getResearch2Defaults(): Research2Defaults {
  const filePath = defaultsPath();
  if (!fs.existsSync(filePath)) {
    return {
      tuning: { ...SYSTEM_RESEARCH2_DEFAULTS.tuning },
      indicator: { ...SYSTEM_RESEARCH2_DEFAULTS.indicator },
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const tuning = (raw.tuning && typeof raw.tuning === "object" ? raw.tuning : {}) as Record<string, unknown>;
    const indicator = (raw.indicator && typeof raw.indicator === "object" ? raw.indicator : {}) as Record<string, unknown>;
    return {
      tuning: {
        minWeeks: coerceNumber(tuning.minWeeks, SYSTEM_RESEARCH2_DEFAULTS.tuning.minWeeks),
        latestMinWeeks: coerceNumber(tuning.latestMinWeeks, SYSTEM_RESEARCH2_DEFAULTS.tuning.latestMinWeeks),
        splitPenalty: coerceNumber(tuning.splitPenalty, SYSTEM_RESEARCH2_DEFAULTS.tuning.splitPenalty),
        maxWeeks: coerceNumber(tuning.maxWeeks, SYSTEM_RESEARCH2_DEFAULTS.tuning.maxWeeks),
      },
      indicator: {
        emaPeriod: coerceNumber(indicator.emaPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.emaPeriod),
        smaPeriod: coerceNumber(indicator.smaPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.smaPeriod),
        adxPeriod: coerceNumber(indicator.adxPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.adxPeriod),
        adxTrendLevel: coerceNumber(indicator.adxTrendLevel, SYSTEM_RESEARCH2_DEFAULTS.indicator.adxTrendLevel),
        rsiPeriod: coerceNumber(indicator.rsiPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.rsiPeriod),
        rsiUpper: coerceNumber(indicator.rsiUpper, SYSTEM_RESEARCH2_DEFAULTS.indicator.rsiUpper),
        rsiLower: coerceNumber(indicator.rsiLower, SYSTEM_RESEARCH2_DEFAULTS.indicator.rsiLower),
        bbPeriod: coerceNumber(indicator.bbPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.bbPeriod),
        bbStdDev: coerceNumber(indicator.bbStdDev, SYSTEM_RESEARCH2_DEFAULTS.indicator.bbStdDev),
        returnZPeriod: coerceNumber(indicator.returnZPeriod, SYSTEM_RESEARCH2_DEFAULTS.indicator.returnZPeriod),
        returnUpper: coerceNumber(indicator.returnUpper, SYSTEM_RESEARCH2_DEFAULTS.indicator.returnUpper),
        returnLower: coerceNumber(indicator.returnLower, SYSTEM_RESEARCH2_DEFAULTS.indicator.returnLower),
        bbwWindow: coerceNumber(indicator.bbwWindow, SYSTEM_RESEARCH2_DEFAULTS.indicator.bbwWindow),
        bbwHigh: coerceNumber(indicator.bbwHigh, SYSTEM_RESEARCH2_DEFAULTS.indicator.bbwHigh),
        bbwLow: coerceNumber(indicator.bbwLow, SYSTEM_RESEARCH2_DEFAULTS.indicator.bbwLow),
      },
    };
  } catch {
    return {
      tuning: { ...SYSTEM_RESEARCH2_DEFAULTS.tuning },
      indicator: { ...SYSTEM_RESEARCH2_DEFAULTS.indicator },
    };
  }
}

export function saveResearch2Defaults(nextDefaults: Partial<Research2Defaults>) {
  const current = getResearch2Defaults();
  const merged: Research2Defaults = {
    tuning: { ...current.tuning, ...(nextDefaults.tuning ?? {}) },
    indicator: { ...current.indicator, ...(nextDefaults.indicator ?? {}) },
  };
  fs.writeFileSync(defaultsPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

export function resetResearch2Defaults(scope?: Research2DefaultsScope) {
  if (!scope) {
    const filePath = defaultsPath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return getResearch2Defaults();
  }
  const current = getResearch2Defaults();
  const next: Research2Defaults = {
    tuning: scope === "tuning" ? { ...SYSTEM_RESEARCH2_DEFAULTS.tuning } : current.tuning,
    indicator: scope === "indicator" ? { ...SYSTEM_RESEARCH2_DEFAULTS.indicator } : current.indicator,
  };
  fs.writeFileSync(defaultsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

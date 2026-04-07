"use server";

import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import {
  resetResearch2Defaults as resetResearch2DefaultFile,
  saveResearch2Defaults as saveResearch2DefaultFile,
  type Research2Defaults,
} from "@/lib/research2-defaults";

type ManualResearchRegimeFileRow = {
  symbol: string;
  start: string;
  end: string;
  label: string;
};

type SaveManualResearchRegimeOptions = {
  replaceOverlaps?: boolean;
};

const ALLOWED_LABELS = new Set(["牛", "小牛", "震荡牛", "震荡", "震荡熊", "小熊", "熊"]);

function regimesPath() {
  return path.resolve(process.cwd(), "lib", "research-manual-regimes.json");
}

function readRows(): ManualResearchRegimeFileRow[] {
  const filePath = regimesPath();
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.symbol !== "string" || typeof row.start !== "string" || typeof row.end !== "string" || typeof row.label !== "string") {
        return null;
      }
      return {
        symbol: row.symbol.trim().toUpperCase(),
        start: row.start,
        end: row.end,
        label: row.label.trim(),
      } satisfies ManualResearchRegimeFileRow;
    })
    .filter((item): item is ManualResearchRegimeFileRow => item !== null);
}

function validateRows(rows: ManualResearchRegimeFileRow[]) {
  const grouped = new Map<string, ManualResearchRegimeFileRow[]>();
  for (const row of rows) {
    if (!row.symbol || row.start >= row.end) {
      throw new Error(`Invalid regime row: ${JSON.stringify(row)}`);
    }
    if (!ALLOWED_LABELS.has(row.label)) {
      throw new Error(`Unsupported label: ${row.label}`);
    }
    const bucket = grouped.get(row.symbol) ?? [];
    bucket.push(row);
    grouped.set(row.symbol, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < bucket.length; index += 1) {
      if (bucket[index - 1].end > bucket[index].start) {
        throw new Error(`Overlapping regimes: ${bucket[index - 1].start}~${bucket[index - 1].end} and ${bucket[index].start}~${bucket[index].end}`);
      }
    }
  }
}

function hasOverlap(left: Pick<ManualResearchRegimeFileRow, "start" | "end">, right: Pick<ManualResearchRegimeFileRow, "start" | "end">) {
  return left.start < right.end && right.start < left.end;
}

export async function saveManualResearchRegimes(symbol: string, rows: ManualResearchRegimeFileRow[], options?: SaveManualResearchRegimeOptions) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const preserved = readRows().filter((row) => row.symbol !== normalizedSymbol);
  const normalizedRows = rows.map((row) => ({
    symbol: normalizedSymbol,
    start: row.start,
    end: row.end,
    label: row.label,
  }));
  const cleanedRows = options?.replaceOverlaps
    ? normalizedRows.filter((row, index, allRows) => {
        const hasNewerOverlap = allRows.some((candidate, candidateIndex) => candidateIndex > index && hasOverlap(row, candidate));
        return !hasNewerOverlap;
      })
    : normalizedRows;
  const merged = [...preserved, ...cleanedRows].sort((left, right) => (left.symbol === right.symbol ? left.start.localeCompare(right.start) : left.symbol.localeCompare(right.symbol)));
  validateRows(merged);
  fs.writeFileSync(regimesPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  revalidatePath("/research");
}

export async function saveResearch2ServerDefaults(defaults: Partial<Research2Defaults>) {
  const saved = saveResearch2DefaultFile(defaults);
  revalidatePath("/research-2");
  return saved;
}

export async function resetResearch2ServerDefaults(scope?: keyof Research2Defaults) {
  const saved = resetResearch2DefaultFile(scope);
  revalidatePath("/research-2");
  return saved;
}

/**
 * burnmeter core: local Claude Code token-spend analytics.
 *
 *   run_efficiency   token-efficiency shares: each category as a
 *                    percentage of total tokens
 *   spend_breakdown  the full report: totals plus a per-model split
 *
 * Data source: Claude Code session logs — JSONL files found
 * recursively under a log directory. The directory comes from the
 * CONTEXTBURN_LOG_DIR environment variable and defaults to
 * ~/.claude/projects. There is no network access and no credential
 * is required, read, or sent.
 *
 * Parsing rules (documented local interpretation):
 * - Every non-blank line is parsed as JSON. A line that fails to
 *   parse, or that parses to a non-object, is skipped and counted
 *   in malformedLines.
 * - An entry "carries usage" when it has a usage object either at
 *   the top level (entry.usage) or nested in its message
 *   (entry.message.usage) — both shapes occur in Claude Code logs.
 *   From a usage object the four documented counts are summed:
 *   input_tokens, output_tokens, cache_creation_input_tokens, and
 *   cache_read_input_tokens. A field that is missing or not a
 *   finite number counts as 0.
 * - The model for an entry is entry.message.model, falling back to
 *   entry.model, falling back to "unknown".
 * - Entries without a usage object are ignored (not malformed).
 *
 * Honesty rule: when the log directory is missing or no usage
 * entries are found, the reports are zeroed and carry an explicit
 * note saying so. That case is a report, not an error, and no
 * numbers are ever fabricated.
 *
 * Efficiency category mapping (documented local interpretation):
 * output = output_tokens, input = input_tokens, cache-creation =
 * cache_creation_input_tokens, cache-read =
 * cache_read_input_tokens, each as a percentage of total tokens,
 * rounded to two decimal places.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AnalyzeOptions,
  EfficiencyReport,
  EfficiencyShares,
  LogFileSource,
  ModelSpend,
  SpendBreakdown,
  TokenCounts,
} from "./types.js";

export const VERSION = "0.1.0";

export const LOG_DIR_ENV = "CONTEXTBURN_LOG_DIR";

export const DEFAULT_LOG_DIR = join(homedir(), ".claude", "projects");

/** Expand a leading "~/" against the user's home directory. */
function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

/**
 * Resolve the log directory: an explicit non-blank value wins, then
 * the CONTEXTBURN_LOG_DIR environment value, then the default
 * ~/.claude/projects.
 */
export function resolveLogDir(value?: string, envValue?: string): string {
  const explicit = typeof value === "string" ? value.trim() : "";
  if (explicit) return expandHome(explicit);
  const env = typeof envValue === "string" ? envValue.trim() : "";
  if (env) return expandHome(env);
  return DEFAULT_LOG_DIR;
}

/** The real-filesystem log source: recursive *.jsonl walk + UTF-8 reads. */
export const nodeLogFileSource: LogFileSource = {
  async listJsonlFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        // A missing (or unreadable) directory contributes no files;
        // the caller reports a zeroed report with a note.
        return;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          found.push(full);
        }
      }
    }
    await walk(root);
    return found;
  },
  async readTextFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function emptyCounts(): TokenCounts {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
  };
}

function addInto(target: TokenCounts, usage: Record<string, unknown>): void {
  target.input_tokens += count(usage.input_tokens);
  target.output_tokens += count(usage.output_tokens);
  target.cache_creation_input_tokens += count(usage.cache_creation_input_tokens);
  target.cache_read_input_tokens += count(usage.cache_read_input_tokens);
}

function finishCounts(target: TokenCounts): void {
  target.total_tokens =
    target.input_tokens +
    target.output_tokens +
    target.cache_creation_input_tokens +
    target.cache_read_input_tokens;
}

/** Find the usage object an entry carries, top-level or under message. */
function extractUsage(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(entry.usage)) return entry.usage;
  if (isRecord(entry.message) && isRecord(entry.message.usage)) return entry.message.usage;
  return undefined;
}

/** Find the model an entry belongs to: message.model, then model, then "unknown". */
function extractModel(entry: Record<string, unknown>): string {
  if (isRecord(entry.message) && typeof entry.message.model === "string" && entry.message.model.trim()) {
    return entry.message.model;
  }
  if (typeof entry.model === "string" && entry.model.trim()) return entry.model;
  return "unknown";
}

interface Analysis {
  logDir: string;
  filesScanned: number;
  entriesWithUsage: number;
  malformedLines: number;
  totals: TokenCounts;
  byModel: ModelSpend[];
  note?: string;
}

async function analyzeLogs(options: AnalyzeOptions = {}): Promise<Analysis> {
  const logDir = resolveLogDir(options.logDir, process.env[LOG_DIR_ENV]);
  const source = options.source ?? nodeLogFileSource;
  const files = await source.listJsonlFiles(logDir);
  const totals = emptyCounts();
  const perModel = new Map<string, ModelSpend>();
  let entriesWithUsage = 0;
  let malformedLines = 0;

  for (const file of files) {
    let text: string;
    try {
      text = await source.readTextFile(file);
    } catch {
      // An unreadable file contributes no lines; it still counts as
      // scanned (it was listed) but nothing in it is parsed.
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (!isRecord(parsed)) {
        malformedLines += 1;
        continue;
      }
      const usage = extractUsage(parsed);
      if (!usage) continue;
      entriesWithUsage += 1;
      addInto(totals, usage);
      const model = extractModel(parsed);
      let bucket = perModel.get(model);
      if (!bucket) {
        bucket = { model, entries: 0, ...emptyCounts() };
        perModel.set(model, bucket);
      }
      bucket.entries += 1;
      addInto(bucket, usage);
    }
  }

  finishCounts(totals);
  const byModel = [...perModel.values()];
  for (const bucket of byModel) finishCounts(bucket);
  byModel.sort(
    (a, b) => b.total_tokens - a.total_tokens || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0),
  );

  const analysis: Analysis = {
    logDir,
    filesScanned: files.length,
    entriesWithUsage,
    malformedLines,
    totals,
    byModel,
  };
  if (entriesWithUsage === 0) {
    analysis.note =
      `No Claude Code usage entries found under ${logDir}; returning a zeroed report. ` +
      `Set ${LOG_DIR_ENV} to point at a different log directory.`;
  }
  return analysis;
}

/** Round to two decimal places. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Percentage shares of total tokens, per category; all zero when the total is zero. */
export function computeShares(totals: TokenCounts): EfficiencyShares {
  const total = totals.total_tokens;
  const share = (n: number): number => (total > 0 ? round2((n / total) * 100) : 0);
  return {
    input_tokens: share(totals.input_tokens),
    output_tokens: share(totals.output_tokens),
    cache_creation_input_tokens: share(totals.cache_creation_input_tokens),
    cache_read_input_tokens: share(totals.cache_read_input_tokens),
  };
}

/** Token-efficiency shares for the logs under the resolved directory. */
export async function runEfficiency(options: AnalyzeOptions = {}): Promise<EfficiencyReport> {
  const a = await analyzeLogs(options);
  const report: EfficiencyReport = {
    logDir: a.logDir,
    filesScanned: a.filesScanned,
    entriesWithUsage: a.entriesWithUsage,
    malformedLines: a.malformedLines,
    totals: a.totals,
    shares: computeShares(a.totals),
  };
  if (a.note) report.note = a.note;
  return report;
}

/** The full token-spend breakdown: totals plus a per-model split. */
export async function spendBreakdown(options: AnalyzeOptions = {}): Promise<SpendBreakdown> {
  const a = await analyzeLogs(options);
  const report: SpendBreakdown = {
    logDir: a.logDir,
    filesScanned: a.filesScanned,
    entriesWithUsage: a.entriesWithUsage,
    malformedLines: a.malformedLines,
    totals: a.totals,
    byModel: a.byModel,
  };
  if (a.note) report.note = a.note;
  return report;
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

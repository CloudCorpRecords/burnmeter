/**
 * burnmeter types.
 *
 * The reports describe Claude Code token usage found in local
 * session JSONL logs. Token fields keep the names Claude Code uses
 * in its usage objects (input_tokens, output_tokens,
 * cache_creation_input_tokens, cache_read_input_tokens) so a report
 * can be compared against the raw logs without a translation table.
 * Filesystem access is described by a minimal injectable source so
 * tests can run against temporary fixture logs (or an in-memory
 * source) and never touch a real log directory.
 */

/** Token counts for one scope (totals, or a single model). */
export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
}

/** Token counts attributed to one model, plus its usage-entry count. */
export interface ModelSpend extends TokenCounts {
  model: string;
  entries: number;
}

/** Full spend report returned by spend_breakdown / `burnmeter breakdown`. */
export interface SpendBreakdown {
  logDir: string;
  filesScanned: number;
  entriesWithUsage: number;
  malformedLines: number;
  totals: TokenCounts;
  byModel: ModelSpend[];
  /** Present only when no usage entries were found: the report is zeroed, honestly. */
  note?: string;
}

/**
 * Efficiency shares: each category as a percentage (0-100, two
 * decimal places) of total tokens. Category mapping (documented
 * local interpretation): input = input_tokens, output =
 * output_tokens, cache_creation = cache_creation_input_tokens,
 * cache_read = cache_read_input_tokens.
 */
export interface EfficiencyShares {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** Efficiency report returned by run_efficiency / `burnmeter efficiency`. */
export interface EfficiencyReport {
  logDir: string;
  filesScanned: number;
  entriesWithUsage: number;
  malformedLines: number;
  totals: TokenCounts;
  shares: EfficiencyShares;
  /** Present only when no usage entries were found: the report is zeroed, honestly. */
  note?: string;
}

/**
 * Injectable filesystem surface for log reading. The default
 * implementation walks a real directory; tests inject a temporary
 * directory (via the root argument) or an in-memory source.
 */
export interface LogFileSource {
  /** Recursively list *.jsonl files under root; a missing root yields []. */
  listJsonlFiles(root: string): Promise<string[]>;
  /** Read one file as UTF-8 text. */
  readTextFile(path: string): Promise<string>;
}

/** Options accepted by the report builders. */
export interface AnalyzeOptions {
  /** Log directory root. Defaults to CONTEXTBURN_LOG_DIR, then ~/.claude/projects. */
  logDir?: string;
  /** Injectable filesystem source; defaults to the real filesystem. */
  source?: LogFileSource;
}

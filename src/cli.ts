#!/usr/bin/env node
/**
 * burnmeter CLI.
 *
 *   burnmeter efficiency [--log-dir <path>]
 *   burnmeter breakdown [--log-dir <path>]
 *   burnmeter mcp
 *
 * Log directory from --log-dir, else CONTEXTBURN_LOG_DIR, else
 * ~/.claude/projects. No network access.
 * Exit codes: 0 success, 1 report error, 2 usage error.
 */
import { formatPayload, LOG_DIR_ENV, runEfficiency, spendBreakdown, VERSION } from "./burnmeter.js";

function usage(): never {
  console.error(`Usage:
  burnmeter efficiency [--log-dir <path>]
  burnmeter breakdown [--log-dir <path>]
  burnmeter mcp
  burnmeter --version

Log directory: --log-dir wins, then ${LOG_DIR_ENV}, then ~/.claude/projects.`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const known = ["efficiency", "breakdown"];
  if (!known.includes(cmd)) usage();
  // Reject stray positional arguments; only --log-dir is accepted.
  const positional = rest.filter((a, i) => a !== "--log-dir" && rest[i - 1] !== "--log-dir");
  if (positional.length) usage();
  const logDir = flag(rest, "--log-dir");
  if (rest.includes("--log-dir") && !logDir) usage();
  try {
    const out =
      cmd === "efficiency"
        ? await runEfficiency({ logDir })
        : await spendBreakdown({ logDir });
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();

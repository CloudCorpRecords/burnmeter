import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLogDir, runEfficiency, spendBreakdown } from "../src/burnmeter.js";
import type { LogFileSource } from "../src/types.js";

/**
 * Hand-computed fixture used by most tests:
 *
 * session1.jsonl (root):
 *   sonnet usage  input 100, output 50, cache-create 20, cache-read 30
 *   sonnet usage  input  10, output  5, cache-create  0, cache-read 15
 *   one malformed line ("{not json")
 *   one entry with no usage object (ignored)
 * sub/session2.jsonl (nested, proves recursion):
 *   haiku usage (nested under message)  input 200, output 100, cc 40, cr 60
 *   haiku usage (top-level shape)       input   0, output  10, cc  5, cr  5
 * notes.txt holds a usage-shaped line but is not .jsonl (ignored).
 *
 * Totals: input 310, output 165, cache-create 65, cache-read 110,
 * total 650, entriesWithUsage 4, malformedLines 1, filesScanned 2.
 * Sonnet: 110 / 55 / 20 / 45 = 230 (2 entries).
 * Haiku:  200 / 110 / 45 / 65 = 420 (2 entries).
 * Shares: input 47.69, output 25.38, cache-create 10, cache-read 16.92.
 */
async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
  const line = (o: unknown) => JSON.stringify(o);
  await writeFile(
    join(dir, "session1.jsonl"),
    [
      line({
        type: "assistant",
        message: {
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
        },
      }),
      line({
        type: "assistant",
        message: {
          model: "claude-sonnet-4",
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 15 },
        },
      }),
      "{not json",
      line({ type: "user", message: { role: "user", content: "hi" } }),
      "",
    ].join("\n"),
  );
  await mkdir(join(dir, "sub"));
  await writeFile(
    join(dir, "sub", "session2.jsonl"),
    [
      line({
        type: "assistant",
        message: {
          model: "claude-haiku-4",
          usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 40, cache_read_input_tokens: 60 },
        },
      }),
      line({
        model: "claude-haiku-4",
        usage: { input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 5 },
      }),
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "notes.txt"),
    line({ usage: { input_tokens: 9999, output_tokens: 9999 } }) + "\n",
  );
  return dir;
}

describe("resolveLogDir", () => {
  it("defaults to ~/.claude/projects, honours env, explicit wins", () => {
    assert.ok(resolveLogDir(undefined, undefined).endsWith(join(".claude", "projects")));
    assert.equal(resolveLogDir(undefined, "/env/logs"), "/env/logs");
    assert.equal(resolveLogDir("/explicit/logs", "/env/logs"), "/explicit/logs");
    assert.equal(resolveLogDir("  ", "/env/logs"), "/env/logs");
  });
});

describe("spendBreakdown", () => {
  it("sums usage across multiple files recursively, ignoring non-.jsonl files", async () => {
    const dir = await makeFixtureDir();
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.logDir, dir);
    assert.equal(out.filesScanned, 2);
    assert.equal(out.entriesWithUsage, 4);
    assert.equal(out.totals.input_tokens, 310);
    assert.equal(out.totals.output_tokens, 165);
    assert.equal(out.totals.cache_creation_input_tokens, 65);
    assert.equal(out.totals.cache_read_input_tokens, 110);
    assert.equal(out.totals.total_tokens, 650);
    assert.equal(out.note, undefined);
  });

  it("splits totals per model, sorted by total tokens descending", async () => {
    const dir = await makeFixtureDir();
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.byModel.length, 2);
    const [first, second] = out.byModel;
    assert.equal(first.model, "claude-haiku-4");
    assert.equal(first.entries, 2);
    assert.equal(first.input_tokens, 200);
    assert.equal(first.output_tokens, 110);
    assert.equal(first.cache_creation_input_tokens, 45);
    assert.equal(first.cache_read_input_tokens, 65);
    assert.equal(first.total_tokens, 420);
    assert.equal(second.model, "claude-sonnet-4");
    assert.equal(second.entries, 2);
    assert.equal(second.input_tokens, 110);
    assert.equal(second.output_tokens, 55);
    assert.equal(second.cache_creation_input_tokens, 20);
    assert.equal(second.cache_read_input_tokens, 45);
    assert.equal(second.total_tokens, 230);
  });

  it("skips and counts malformed lines; entries without usage are ignored", async () => {
    const dir = await makeFixtureDir();
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.malformedLines, 1);
    assert.equal(out.entriesWithUsage, 4);
  });

  it("groups usage without a model under unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
    await writeFile(
      join(dir, "a.jsonl"),
      JSON.stringify({ usage: { input_tokens: 3, output_tokens: 2 } }) + "\n",
    );
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.byModel.length, 1);
    assert.equal(out.byModel[0].model, "unknown");
    assert.equal(out.byModel[0].total_tokens, 5);
  });

  it("counts missing cache fields in a usage object as zero", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
    await writeFile(
      join(dir, "a.jsonl"),
      JSON.stringify({
        message: { model: "m1", usage: { input_tokens: 7, output_tokens: 3 } },
      }) + "\n",
    );
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.totals.cache_creation_input_tokens, 0);
    assert.equal(out.totals.cache_read_input_tokens, 0);
    assert.equal(out.totals.total_tokens, 10);
  });

  it("missing directory returns a zeroed report with an explicit note", async () => {
    const missing = join(tmpdir(), "burnmeter-definitely-missing-dir");
    const out = await spendBreakdown({ logDir: missing });
    assert.equal(out.filesScanned, 0);
    assert.equal(out.entriesWithUsage, 0);
    assert.equal(out.malformedLines, 0);
    assert.equal(out.totals.total_tokens, 0);
    assert.deepEqual(out.byModel, []);
    assert.ok(out.note && out.note.includes("No Claude Code usage entries found"));
    assert.ok(out.note.includes(missing));
  });

  it("empty directory returns a zeroed report with an explicit note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.filesScanned, 0);
    assert.equal(out.totals.total_tokens, 0);
    assert.ok(out.note && out.note.includes("No Claude Code usage entries found"));
  });

  it("files without any usage entries return a zeroed report with a note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
    await writeFile(join(dir, "a.jsonl"), JSON.stringify({ type: "user" }) + "\n");
    const out = await spendBreakdown({ logDir: dir });
    assert.equal(out.filesScanned, 1);
    assert.equal(out.entriesWithUsage, 0);
    assert.equal(out.totals.total_tokens, 0);
    assert.ok(out.note && out.note.includes("No Claude Code usage entries found"));
  });
});

describe("runEfficiency", () => {
  it("returns hand-computed shares that sum to ~100%", async () => {
    const dir = await makeFixtureDir();
    const out = await runEfficiency({ logDir: dir });
    assert.equal(out.totals.total_tokens, 650);
    assert.equal(out.shares.input_tokens, 47.69);
    assert.equal(out.shares.output_tokens, 25.38);
    assert.equal(out.shares.cache_creation_input_tokens, 10);
    assert.equal(out.shares.cache_read_input_tokens, 16.92);
    const sum =
      out.shares.input_tokens +
      out.shares.output_tokens +
      out.shares.cache_creation_input_tokens +
      out.shares.cache_read_input_tokens;
    assert.ok(Math.abs(sum - 100) < 0.05, `shares sum ${sum}`);
    assert.equal(out.note, undefined);
  });

  it("zeroed shares with a note when there is no usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "burnmeter-test-"));
    const out = await runEfficiency({ logDir: dir });
    assert.deepEqual(out.shares, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    assert.ok(out.note && out.note.includes("No Claude Code usage entries found"));
  });
});

describe("injectable source", () => {
  it("analyses an in-memory source without touching the filesystem", async () => {
    const source: LogFileSource = {
      listJsonlFiles: async (root) => [`${root}/virtual.jsonl`],
      readTextFile: async () =>
        JSON.stringify({
          message: {
            model: "virtual-model",
            usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 },
          },
        }) + "\n",
    };
    const out = await spendBreakdown({ logDir: "/virtual", source });
    assert.equal(out.filesScanned, 1);
    assert.equal(out.totals.total_tokens, 10);
    assert.equal(out.byModel[0].model, "virtual-model");
  });
});

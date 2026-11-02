/**
 * burnmeter MCP server. Tools: run_efficiency, spend_breakdown.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * Both tools are parameterless as documented in the public spec:
 * each serves an empty-properties input schema. The log directory
 * is read from CONTEXTBURN_LOG_DIR at call time and defaults to
 * ~/.claude/projects. No network access is involved.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatPayload, runEfficiency, spendBreakdown, VERSION } from "./burnmeter.js";

const NoArgs = z.object({});

const TOOLS = [
  {
    name: "run_efficiency",
    description: "Return token-efficiency shares for Claude Code usage: how total tokens split across output, input, cache-creation and cache-read.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "spend_breakdown",
    description: "Return the full Claude Code token-spend breakdown: totals and per-model usage from local session logs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "burnmeter", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "run_efficiency") {
      NoArgs.parse(args ?? {});
      out = await runEfficiency();
    } else if (name === "spend_breakdown") {
      NoArgs.parse(args ?? {});
      out = await spendBreakdown();
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();

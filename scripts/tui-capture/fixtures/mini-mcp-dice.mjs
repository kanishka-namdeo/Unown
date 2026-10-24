#!/usr/bin/env bun
/**
 * mini-mcp-dice.mjs — a real, dependency-free MCP stdio server for the
 * capture lane's "Mcp" story (dex № 002: "Plug a tool in anywhere — its
 * arms already know the shape").
 *
 * Speaks the actual MCP protocol over stdio (newline-delimited JSON-RPC
 * 2.0): initialize handshake → tools/list → tools/call. One tool, `roll`,
 * so the captured session shows a genuine mcp__dice__roll call and its
 * result riding the session's normal tool plumbing — permissions, tool
 * blocks and all — with zero network and zero nondeterministic behavior
 * beyond the roll itself.
 *
 * The roll honors an optional `seed` for reproducibility (the capture never
 * passes one; a real roll is the honest demo) and clamps sides to 2..1000.
 *
 * Used by scripts/tui-capture/scenarios/index.js (s14-mcp) via:
 *   unown mcp add dice bun <this-file> --scope project   (in the demo dir)
 */
import { createInterface } from "node:readline";

const log = (...a) => process.stderr.write(`[mini-mcp-dice] ${a.join(" ")}\n`);

const TOOLS = [
  {
    name: "roll",
    description:
      "Roll an N-sided die (default 20) and return the result. Pure demo tool of the dice MCP server.",
    inputSchema: {
      type: "object",
      properties: {
        sides: { type: "number", description: "Number of sides on the die (2-1000, default 20)" },
        seed: { type: "number", description: "Optional seed for a reproducible roll" },
      },
      required: [],
    },
  },
];

const rl = createInterface({ input: process.stdin, terminal: false });
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyErr = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const roll = (sides, seed) => {
  const n = Math.min(1000, Math.max(2, Number(sides) || 20));
  let v;
  if (seed !== undefined && seed !== null && !Number.isNaN(Number(seed))) {
    // xorshift32 from the seed — stable across runs, no deps
    let x = (Math.floor(Math.abs(Number(seed)) % 2147483647) || 42) | 0;
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    v = (Math.abs(x) % n) + 1;
  } else {
    v = Math.floor(Math.random() * n) + 1;
  }
  return `You rolled a ${v} on a d${n}.`;
};

rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log("unparseable line:", line.slice(0, 120));
    return;
  }
  const { id, method, params } = msg;
  // notifications (initialized, cancelled) get no reply per JSON-RPC
  if (id === undefined || id === null) {
    log("notification:", method);
    return;
  }
  try {
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mini-mcp-dice", version: "1.0.0" },
        });
        break;
      case "tools/list":
        reply(id, { tools: TOOLS });
        break;
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name !== "roll") {
          replyErr(id, -32602, `Unknown tool: ${name}`);
          break;
        }
        const text = roll(args.sides, args.seed);
        reply(id, { content: [{ type: "text", text }], isError: false });
        break;
      }
      case "ping":
        reply(id, {});
        break;
      default:
        replyErr(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    replyErr(id, -32603, `Internal error: ${e}`);
  }
});

rl.on("close", () => {
  log("stdin closed — exiting");
  process.exit(0);
});

log("mini-mcp-dice stdio server up — tools: roll(sides, seed)");

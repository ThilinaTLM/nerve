import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { resolveDevBenchTurn } from "../../src/models/dev-bench-provider.js";
import {
  buildDevBenchScript,
  DEV_BENCH_FIRST_TOKEN_MS,
  DEV_BENCH_TOKEN_SIZE,
  DEV_BENCH_TOKENS_PER_SECOND,
} from "../../src/models/dev-bench-script.js";

test("dev bench script is deterministic with ~16 tool calls", () => {
  const dir = "qa-sandbox-bench-123";
  const script = buildDevBenchScript(dir);
  assert.deepEqual(script, buildDevBenchScript(dir));
  const tools = script.filter((turn) => turn.tool);
  assert.equal(tools.length, 16);
  assert.equal(script.at(-1)?.tool, undefined);
  assert.ok(
    tools.every(
      (turn) =>
        JSON.stringify(turn.tool).includes(dir) ||
        turn.tool!.name === "todos_set",
    ),
  );
});

test("dev bench streams for roughly 30-45 seconds", () => {
  const script = buildDevBenchScript("qa-sandbox-bench-1");
  const chars = script.reduce(
    (sum, turn) =>
      sum +
      turn.thinking.length +
      turn.text.length +
      JSON.stringify(turn.tool?.args ?? "").length,
    0,
  );
  const streamMs =
    (chars / (DEV_BENCH_TOKEN_SIZE * 4)) *
    ((DEV_BENCH_TOKEN_SIZE / DEV_BENCH_TOKENS_PER_SECOND) * 1000);
  const total = streamMs + script.length * DEV_BENCH_FIRST_TOKEN_MS + 12 * 400;
  assert.ok(total > 28_000 && total < 45_000, `estimated ${total} ms`);
});

test("turn index and folder come from the transcript", () => {
  const assistant = { role: "assistant", content: [] } as unknown as Message;
  const toolResult = { role: "toolResult" } as unknown as Message;
  const messages = [
    { role: "user", content: "old qa-sandbox-bench-1" },
    {
      role: "user",
      content: [{ type: "text", text: "go in qa-sandbox-bench-42 now" }],
    },
    assistant,
    toolResult,
    assistant,
    toolResult,
  ] as unknown as Message[];
  assert.deepEqual(resolveDevBenchTurn(messages), {
    index: 2,
    dir: "qa-sandbox-bench-42",
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AsyncBash } from "@nervekit/contracts/core";
import {
  backgroundLabel,
  backgroundLines,
  formatNamedStatus,
  formatStatusList,
  type ChildStatus,
} from "./subagent-status.js";

/**
 * The workbench app parses these texts and reads this fixture in its parser
 * tests. Status and waiting-notice strings are checked against the formatters
 * below; the prompt, stop and notice strings are fixtures mirroring the exact
 * texts asserted in delegation-tools.test.ts.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL("./subagent-core-texts.fixture.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;

const NOW = Date.parse("2026-01-01T01:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const command = (startedAt: string) =>
  ({ command: "pnpm test", startedAt }) as AsyncBash;
const child = (patch: Partial<ChildStatus>): ChildStatus => ({
  name: "auth-research",
  profile: "explore",
  model: "openai/gpt-5.1",
  state: "running",
  background: [],
  context: { tokens: 34_500, window: 200_000, percent: 34 },
  lastActivityAt: ago(20_000),
  runningSince: ago(180_000),
  ...patch,
});

void test("status texts match the fixture the app parses", () => {
  assert.equal(
    formatStatusList(
      [
        child({}),
        child({
          name: "refresh-fix",
          profile: "developer",
          state: "idle",
          background: [command(ago(180_000))],
          context: { tokens: 0, window: 0, percent: 51 },
          lastActivityAt: ago(60_000),
        }),
        child({
          name: "token-store",
          profile: null,
          state: "idle",
          context: { tokens: 0, window: 0, percent: null },
          lastActivityAt: null,
        }),
      ],
      NOW,
    ),
    fixture.statusList,
  );
  assert.equal(
    formatNamedStatus(
      {
        child: child({}),
        finalResponse: "",
        failure: null,
        activity: ["✓ read src/auth.ts", '… bash "pnpm test" (3m)'],
      },
      NOW,
    ),
    fixture.statusNamed,
  );
});

void test("waiting notice commands match the fixture", () => {
  const lines = backgroundLines([command(ago(180_000))], NOW);
  assert.equal(
    `Sub-agent "refresh-fix" (developer) is waiting on ${backgroundLabel(1)} and accepts follow-ups:\n${lines.join("\n")}\npartial`,
    fixture.noticeWaiting,
  );
});

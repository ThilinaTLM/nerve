import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type { CenterTabModel } from "$lib/application/workspace";
import {
  statusLabel,
  tabLabel,
  tabTitle,
  tabIdentity,
  tabIndex,
} from "./editor-tab-helpers.js";

test("async bash tab identity retains routing metadata and distinguishes runs of the same command", () => {
  const first: Extract<CenterTabModel, { kind: "async-bash" }> = {
    kind: "async-bash",
    id: "bash1",
    conversationId: "conv1",
    projectId: "project1",
    command: "pnpm test",
    active: true,
    sending: false,
  };
  const second = { ...first, id: "bash2" };
  assert.deepEqual(tabIdentity(first), {
    kind: "async-bash",
    id: "bash1",
    conversationId: "conv1",
    projectId: "project1",
    command: "pnpm test",
  });
  assert.equal(tabIndex([first, second], second), 1);
  assert.equal(
    tabIndex([first, second], { ...first, command: "updated metadata" }),
    0,
  );
  assert.equal(
    tabIndex(
      [{ kind: "launch", id: first.id, active: false, sending: false }, first],
      first,
    ),
    1,
  );
  assert.equal(tabLabel(first), "pnpm test");
  assert.equal(tabTitle(first), "pnpm test · bash1");
});

function launch(patch: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    id: "launch_a",
    cwd: "/repo",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/out",
    stderrPath: "/tmp/err",
    logsPath: "/tmp/logs",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    visibility: "background",
    ...patch,
  };
}

function tab(
  record: LaunchRecord,
): Extract<CenterTabModel, { kind: "launch" }> {
  return {
    kind: "launch",
    id: "launchdef_a",
    launch: record,
    active: true,
    sending: true,
  };
}

test("uses a launch definition display label for launch tabs and titles", () => {
  const model = tab(
    launch({
      displayName: "Workbench UI",
      name: "legacy",
      command: "pnpm dev",
    }),
  );

  assert.equal(tabLabel(model), "Workbench UI");
  assert.match(tabTitle(model), /^Workbench UI · running ·/);
});

test("labels embedded Mermaid tabs with their source and block location", () => {
  const model: Extract<CenterTabModel, { kind: "mermaid" }> = {
    kind: "mermaid",
    id: "diagram_a",
    origin: "file",
    path: "/repo/docs/architecture.md",
    relativePath: "docs/architecture.md",
    name: "architecture.md",
    locator: { ordinal: 1, startLine: 42, fingerprint: "abc" },
    active: true,
    sending: true,
  };

  assert.equal(tabLabel(model), "architecture.md · diagram 2");
  assert.equal(
    tabTitle(model),
    "/repo/docs/architecture.md · Mermaid diagram at line 42",
  );
  assert.equal(statusLabel(model), "Loading diagram");
});

test("labels Mermaid tabs opened from assistant messages", () => {
  const model: Extract<CenterTabModel, { kind: "mermaid" }> = {
    kind: "mermaid",
    id: "diagram_assistant",
    origin: "inline",
    name: "Assistant diagram",
    locator: { ordinal: 1, startLine: 12, fingerprint: "def" },
    active: true,
    sending: false,
  };

  assert.equal(tabLabel(model), "Assistant diagram 2");
  assert.equal(
    tabTitle(model),
    "Assistant diagram 2 · Mermaid diagram from assistant message",
  );
});

test("labels the Discover singleton tab", () => {
  const model: Extract<CenterTabModel, { kind: "discover" }> = {
    kind: "discover",
    id: "discover",
    active: true,
    sending: false,
  };

  assert.equal(tabLabel(model), "Discover");
  assert.equal(tabTitle(model), "Discover Nerve");
});

test("falls back from blank display names to name and command", () => {
  assert.equal(
    tabLabel(tab(launch({ displayName: "  ", name: "API" }))),
    "API",
  );
  assert.equal(
    tabLabel(
      tab(launch({ displayName: " ", name: " ", command: "pnpm test" })),
    ),
    "pnpm test",
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  isValidLaunchPort,
  projectLaunchPanel,
  siblingLaunchRuns,
  launchDefinitionRequest,
  launchDefinitionLabel,
  launchPanelActiveItemKey,
  launchRunLabel,
} from "./launch-panel-controller.js";
import type { LaunchPanelDefinition } from "./launch-panel-types.js";

function run(id: string, patch: Partial<LaunchRecord> = {}): LaunchRecord {
  const now = new Date().toISOString();
  return {
    id,
    cwd: "/repo",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/out",
    stderrPath: "/tmp/err",
    logsPath: "/tmp/logs",
    startedAt: now,
    updatedAt: now,
    visibility: "background",
    ...patch,
  };
}

test("maps selected log streams to their single visual launch item", () => {
  assert.equal(launchPanelActiveItemKey(undefined), undefined);
  assert.equal(launchPanelActiveItemKey(run("adhoc")), "adhoc");
  assert.equal(
    launchPanelActiveItemKey(
      run("definition-run", { definitionId: "launchdef_a" }),
    ),
    "launchdef_a",
  );
  assert.equal(
    launchPanelActiveItemKey(
      run("restarted-run", { restartRootLaunchId: "original-run" }),
    ),
    "restarted-run",
  );
});

function definition(
  patch: Partial<LaunchPanelDefinition> = {},
): LaunchPanelDefinition {
  const now = new Date().toISOString();
  return {
    id: "launchdef_a",
    label: "Web",
    command: "pnpm dev",
    runPolicy: "single",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test("collapses a definition's concurrent runs into one definition entry while listing each run", () => {
  const projected = projectLaunchPanel(
    [definition({ runPolicy: "concurrent" })],
    [
      run("launch_a", { definitionId: "launchdef_a" }),
      run("launch_b", { definitionId: "launchdef_a" }),
    ],
  );
  assert.equal(projected.definitions.length, 1);
  assert.equal(projected.definitions[0]?.runs.length, 2);
  assert.equal(projected.definitions[0]?.activeRuns.length, 2);
  assert.equal(projected.runs.length, 0);
});

test("blends alphabetical and recency ranks without moving a newly run launch to the top", () => {
  const definitions = [
    definition({ id: "launchdef_alpha", label: "Alpha" }),
    definition({ id: "launchdef_bravo", label: "Bravo" }),
    definition({ id: "launchdef_charlie", label: "Charlie" }),
    definition({ id: "launchdef_zulu", label: "Zulu" }),
  ];
  const projected = projectLaunchPanel(definitions, [
    run("launch_zulu", {
      definitionId: "launchdef_zulu",
      startedAt: "2026-01-04T00:00:00Z",
    }),
    run("launch_alpha", {
      definitionId: "launchdef_alpha",
      startedAt: "2026-01-03T00:00:00Z",
    }),
    run("launch_bravo", {
      definitionId: "launchdef_bravo",
      startedAt: "2026-01-02T00:00:00Z",
    }),
    run("launch_charlie", {
      definitionId: "launchdef_charlie",
      startedAt: "2026-01-01T00:00:00Z",
    }),
  ]);

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.label),
    ["Alpha", "Bravo", "Zulu", "Charlie"],
  );
});

test("lets recency modestly improve nearby alphabetical positions", () => {
  const projected = projectLaunchPanel(
    [
      definition({ id: "launchdef_alpha", label: "Alpha" }),
      definition({ id: "launchdef_bravo", label: "Bravo" }),
      definition({ id: "launchdef_charlie", label: "Charlie" }),
      definition({ id: "launchdef_delta", label: "Delta" }),
    ],
    [
      run("launch_bravo", {
        definitionId: "launchdef_bravo",
        startedAt: "2026-01-04T00:00:00Z",
      }),
      run("launch_charlie", {
        definitionId: "launchdef_charlie",
        startedAt: "2026-01-03T00:00:00Z",
      }),
      run("launch_delta", {
        definitionId: "launchdef_delta",
        startedAt: "2026-01-02T00:00:00Z",
      }),
      run("launch_alpha", {
        definitionId: "launchdef_alpha",
        startedAt: "2026-01-01T00:00:00Z",
      }),
    ],
  );

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.label),
    ["Bravo", "Alpha", "Charlie", "Delta"],
  );
});

test("sorts equally ranked definitions deterministically by label", () => {
  const timestamp = "2026-01-01T00:00:00Z";
  const projected = projectLaunchPanel(
    [
      definition({
        id: "launchdef_zebra",
        label: "zebra",
        updatedAt: timestamp,
      }),
      definition({
        id: "launchdef_alpha",
        label: "Alpha",
        updatedAt: timestamp,
      }),
    ],
    [],
  );

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.id),
    ["launchdef_alpha", "launchdef_zebra"],
  );
});

test("lists only ad-hoc runs at the top level", () => {
  const projected = projectLaunchPanel(
    [definition()],
    [run("launch_def", { definitionId: "launchdef_a" }), run("launch_adhoc")],
  );
  assert.deepEqual(
    projected.runs.map((entry) => entry.key),
    ["launch_adhoc"],
  );
  assert.deepEqual(
    projected.definitions[0]?.runs.map((entry) => entry.key),
    ["launch_def"],
  );
});

test("keeps definitions without runs and ad-hoc runs without definitions", () => {
  const projected = projectLaunchPanel(
    [definition()],
    [run("launch_adhoc", { status: "completed" })],
  );
  assert.equal(projected.definitions.length, 1);
  assert.equal(projected.definitions[0]?.runs.length, 0);
  assert.equal(projected.definitions[0]?.latestRun, undefined);
  assert.equal(projected.runs.length, 1);
  assert.equal(projected.runs[0]?.definition, undefined);
  assert.equal(projected.runs[0]?.isActive, false);
});

test("projects force-kill and removal safety from explicit statuses", () => {
  const projected = projectLaunchPanel(
    [],
    [
      run("launch_stopping", { status: "stopping" }),
      run("launch_done", { status: "cancelled" }),
    ],
  );
  const entries = new Map(projected.runs.map((entry) => [entry.key, entry]));

  assert.equal(entries.get("launch_stopping")?.canForceKill, true);
  assert.equal(entries.get("launch_done")?.isRemovable, true);
});

test("labels definitions by their label and runs by display name, then command", () => {
  const projected = projectLaunchPanel(
    [definition()],
    [
      run("launch_a", { definitionId: "launchdef_a", displayName: "api" }),
      run("launch_b", { displayName: "api" }),
      run("launch_c"),
    ],
  );
  assert.deepEqual(launchDefinitionLabel(projected.definitions[0]!), {
    text: "Web",
    isCommand: false,
  });

  const byId = new Map(
    [...projected.definitions[0]!.runs, ...projected.runs].map((entry) => [
      entry.key,
      entry,
    ]),
  );
  assert.deepEqual(launchRunLabel(byId.get("launch_a")!), {
    text: "api",
    isCommand: false,
  });
  assert.deepEqual(launchRunLabel(byId.get("launch_b")!), {
    text: "api",
    isCommand: false,
  });
  assert.deepEqual(launchRunLabel(byId.get("launch_c")!), {
    text: "pnpm dev",
    isCommand: true,
  });
});

test("builds saved-launch requests only from a command and a valid port", () => {
  const base = {
    label: "",
    command: "pnpm dev",
    cwd: "",
    port: undefined,
    runPolicy: "single" as const,
  };
  assert.equal(launchDefinitionRequest({ ...base, command: "   " }), undefined);
  for (const port of [0, 65_536, 1.5]) {
    assert.equal(isValidLaunchPort(port), false);
    assert.equal(launchDefinitionRequest({ ...base, port }), undefined);
  }
  assert.deepEqual(launchDefinitionRequest(base), {
    command: "pnpm dev",
    runPolicy: "single",
  });
  assert.deepEqual(
    launchDefinitionRequest({
      label: "  web  ",
      command: " pnpm dev ",
      cwd: " apps/web ",
      port: 3000,
      runPolicy: "concurrent",
    }),
    {
      command: "pnpm dev",
      label: "web",
      cwd: "apps/web",
      port: 3000,
      runPolicy: "concurrent",
    },
  );
});

test("groups sibling runs by their center-tab entry, newest first", () => {
  const launches = [
    run("t1", { definitionId: "d1", startedAt: "2026-01-01T00:00:00Z" }),
    run("t2", { definitionId: "d1", startedAt: "2026-01-02T00:00:00Z" }),
    run("t3", { startedAt: "2026-01-03T00:00:00Z" }),
    run("t4", { restartRootLaunchId: "t3", startedAt: "2026-01-04T00:00:00Z" }),
  ];
  assert.deepEqual(
    siblingLaunchRuns(launches, "t1").map((launch) => launch.id),
    ["t2", "t1"],
  );
  assert.deepEqual(
    siblingLaunchRuns(launches, "t3").map((launch) => launch.id),
    ["t4", "t3"],
  );
  assert.deepEqual(siblingLaunchRuns(launches, "missing"), []);
});

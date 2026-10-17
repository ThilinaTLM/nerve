import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  isValidLaunchPort,
  launchActivity,
  launchEntryId,
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
    projectId: "proj_a",
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
    scope: { kind: "project", projectId: "proj_a" },
    parentFolderId: null,
    order: 0,
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

test("saved placement order wins over names and execution recency", () => {
  const projected = projectLaunchPanel(
    [
      definition({ id: "launchdef_z", label: "Zulu", order: 0 }),
      definition({ id: "launchdef_a", label: "Alpha", order: 1 }),
    ],
    [run("recent", { definitionId: "launchdef_a" })],
  );
  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.label),
    ["Zulu", "Alpha"],
  );
});
test("copied IDs never join runs across projects; orphans remain controllable", () => {
  const projected = projectLaunchPanel(
    [definition()],
    [
      run("other", { projectId: "proj_b", definitionId: "launchdef_a" }),
      run("orphan", { definitionId: "launchdef_deleted" }),
    ],
  );
  assert.equal(projected.definitions[0]?.runs.length, 0);
  assert.equal(projected.runs.length, 2);
  assert.notEqual(
    launchEntryId(run("a", { definitionId: "launchdef_a" })),
    launchEntryId(
      run("b", { projectId: "proj_b", definitionId: "launchdef_a" }),
    ),
  );
  assert.equal(
    launchEntryId(run("retry", { restartRootLaunchId: "root" })),
    "root",
  );
});
test("counts distinct active definitions through all folder ancestors", () => {
  const definitions = [
    definition({ parentFolderId: "child" }),
    definition({ id: "launchdef_b", parentFolderId: "parent" }),
  ];
  const folders = [
    { id: "parent", label: "Parent", parentFolderId: null, order: 0 },
    { id: "child", label: "Child", parentFolderId: "parent", order: 0 },
  ];
  const activity = launchActivity(definitions, folders, [
    run("a", { definitionId: "launchdef_a", status: "starting" }),
    run("b", { definitionId: "launchdef_a", status: "stopping" }),
    run("c", { definitionId: "launchdef_b", status: "ready" }),
    run("orphan", { definitionId: "deleted" }),
  ]);
  assert.equal(activity.activeDefinitionCount, 2);
  assert.equal(activity.folderCounts.get("parent"), 2);
  assert.equal(activity.folderCounts.get("child"), 1);
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

test("cold catalog failures keep linked runs visible without asserting deletion", () => {
  const runs = [run("linked", { definitionId: "launchdef_a" }), run("unsaved")];
  const projected = projectLaunchPanel([], runs, false);
  assert.equal(projected.runs.length, 2);
  assert.equal(
    projected.runs.find((entry) => entry.key === "linked")
      ?.definitionUnavailable,
    true,
  );
  assert.equal(
    projected.runs.find((entry) => entry.key === "linked")?.isActive,
    true,
  );
  assert.equal(
    projected.runs.find((entry) => entry.key === "unsaved")
      ?.definitionUnavailable,
    undefined,
  );
});
test("retained catalog data still joins known definitions while failures mark only unresolved runs", () => {
  const projected = projectLaunchPanel(
    [definition()],
    [
      run("linked", { definitionId: "launchdef_a" }),
      run("unknown", { definitionId: "launchdef_unknown" }),
    ],
    false,
  );
  assert.equal(projected.definitions[0]?.runs.length, 1);
  assert.equal(projected.runs.length, 1);
  assert.equal(projected.runs[0]?.definitionUnavailable, true);
});
test("authoritative deletion exposes normal orphan runs with all controls", () => {
  const projected = projectLaunchPanel(
    [],
    [run("deleted", { definitionId: "launchdef_a", status: "stopping" })],
    true,
  );
  assert.equal(projected.runs[0]?.definitionUnavailable, undefined);
  assert.equal(projected.runs[0]?.canForceKill, true);
});

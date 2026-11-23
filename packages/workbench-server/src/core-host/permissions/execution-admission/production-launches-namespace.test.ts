import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { prepareShellProcess } from "../../../infrastructure/process-host/shell-process.js";
import {
  productionAdmissionFixture,
  until,
  type ProductionAdmissionFixture,
} from "./production-admission-fixture.js";

async function definition(
  f: ProductionAdmissionFixture,
  cwd: string,
  command = "serve original",
) {
  return f.definitions.create(
    "proj_admission",
    {
      label: "Dev",
      command,
      cwd,
      runPolicy: "single",
      parentFolderId: null,
      beforeSibling: null,
    },
    (await f.definitions.catalog("proj_admission")).revision,
  );
}
async function request(f: ProductionAdmissionFixture) {
  await f.runtime.core.start();
  f.runtime.core.submitInput({
    conversationId: "c",
    inputId: "launch-prompt",
    text: "Start the dev server.",
    source: "user",
  });
  await until(() =>
    f.runtime.storage.toolCalls
      .list("c")
      .some((call) => call.state === "awaiting_approval"),
  );
  return f.runtime.storage.toolCalls
    .list("c")
    .find((call) => call.state === "awaiting_approval")!.id;
}
async function approve(
  f: ProductionAdmissionFixture,
  id: string,
  resolutionRequestId: string,
) {
  await f.runtime.core.resolveInteraction({
    toolCallId: id,
    resolutionRequestId,
    resolution: { kind: "approval", decision: "approve" },
  });
}
async function completed(f: ProductionAdmissionFixture, id: string) {
  await until(() => !f.runtime.storage.toolCalls.get(id));
  const response = f.runtime.storage.events
    .since("c", 0)
    .find(
      (event) =>
        event.type === "tool_call_response" && event.payload.toolCallId === id,
    );
  if (response?.type !== "tool_call_response")
    assert.fail("Expected quick_script response");
  assert.equal(response.payload.outcome, "completed");
}

const script = (code: string) => [
  {
    type: "toolCall" as const,
    id: "provider-launch",
    name: "quick_script",
    args: { code },
  },
  { type: "waitForAbort" as const },
];

void test(
  "launches.start in an approved script runs the definition's command through the real service",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(
      t,
      script('return await launches.start("Dev");'),
    );
    const cwd = join(f.project, "app");
    await mkdir(cwd);
    const created = await definition(f, cwd);
    await f.save({ permissionRuleSetId: "supervised" });
    const id = await request(f);
    await approve(f, id, "approve-start");
    await completed(f, id);
    assert.equal(f.launchSpawns.length, 1);
    assert.equal(f.launchSpawns[0].command, created.definition.command);
    assert.equal(f.launchSpawns[0].options.cwd, cwd);
    assert.equal(
      f.launchSpawns[0].options.preparedShell!.invocation.launch.shell,
      await realpath("/bin/sh"),
    );
  },
);

void test(
  "launches.restart of a standalone run keeps its lineage",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(
      t,
      script('return await launches.restart("Ad hoc");'),
    );
    const shellPath = await realpath("/bin/sh");
    const initial = await f.launches.start({
      projectId: "proj_admission",
      command: "standalone command",
      displayName: "Ad hoc",
      cwd: f.project,
      preparedShell: prepareShellProcess("standalone command", {
        cwd: f.project,
        shellPath,
      }),
    });
    f.launchSpawns.length = 0;
    await f.save({ permissionRuleSetId: "supervised" });
    const id = await request(f);
    await approve(f, id, "approve-standalone");
    await completed(f, id);
    assert.equal(f.launchSpawns.length, 1);
    const restarted = (await f.launches.list()).find(
      (launch) => launch.id !== initial.id,
    )!;
    assert.equal(restarted.restartedFromLaunchId, initial.id);
    assert.equal(restarted.restartRootLaunchId, initial.id);
    assert.equal(restarted.command, initial.command);
  },
);

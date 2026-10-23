import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import type { ToolApprovalBinding } from "@nervekit/contracts/core";
import { LaunchTool } from "../launch-tool.js";
import { prepareShellProcess } from "../../infrastructure/process-host/shell-process.js";
import { canonicalDigest } from "./admission.js";
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
async function expectedTarget(
  f: ProductionAdmissionFixture,
  action: "start" | "restart",
  name: string,
  shell = "/bin/sh",
) {
  const shellPath = await realpath(shell);
  const prepared = await new LaunchTool({
    launches: f.launches,
    definitions: f.definitions,
    project: () => f.runtime.core.projects.get("proj_admission")!,
    notify: () => {},
  }).prepare({ action, name }, "c", "model", undefined, shellPath);
  // This is the production host identity: no credentials or environment values are hashed.
  const target = {
    toolConfiguration: null,
    modelConfiguration: null,
    python: null,
    account: null,
    shellPath,
    ...prepared.target,
    cwd: prepared.cwd,
  };
  return { digest: canonicalDigest({ target, cwd: prepared.cwd }), target };
}
function grantAtDispatch(f: ProductionAdmissionFixture) {
  let grant: ToolApprovalBinding | undefined;
  f.runtime.core.subscribe((change) => {
    if (
      change.kind === "tool_call_changed" &&
      !("removed" in change.toolCall) &&
      change.toolCall.toolName === "launch" &&
      change.toolCall.state === "running"
    )
      grant = change.toolCall.supervision?.approval;
  });
  return () => grant;
}
async function request(f: ProductionAdmissionFixture) {
  await f.runtime.core.start();
  await f.runtime.core.submitInput({
    conversationId: "c",
    inputId: "launch-prompt",
    text: "Run the selected launch.",
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
    assert.fail("Expected launch response");
  assert.equal(response.payload.outcome, "completed");
}

for (const action of ["start", "restart"] as const) {
  void test(
    `production launch ${action}: admitted target reaches the real service/adapters unchanged after asynchronous publication`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await productionAdmissionFixture(t, [
        {
          type: "toolCall",
          id: "provider-launch",
          name: "launch",
          args: { action, name: "Dev" },
        },
        { type: "waitForAbort" },
      ]);
      const cwd = join(f.project, "app");
      await mkdir(cwd);
      const created = await definition(f, cwd);
      const shellPath = await realpath("/bin/sh");
      if (action === "restart") {
        await f.launches.start({
          definitionId: created.definition.id,
          projectId: "proj_admission",
          command: "previous command",
          cwd,
          preparedShell: prepareShellProcess("previous command", {
            cwd,
            shellPath,
          }),
        });
        f.launchSpawns.length = 0;
      }
      await f.save({ permissionRuleSetId: "supervised" });
      const previousPath = process.env.PATH;
      const previousProbe = process.env.NERVE_LAUNCH_ADMISSION_PROBE;
      t.after(() => {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousProbe === undefined)
          delete process.env.NERVE_LAUNCH_ADMISSION_PROBE;
        else process.env.NERVE_LAUNCH_ADMISSION_PROBE = previousProbe;
      });
      process.env.PATH = `${cwd}:${previousPath ?? ""}`;
      process.env.NERVE_LAUNCH_ADMISSION_PROBE = "admitted";
      const expectedInvocation = prepareShellProcess(
        created.definition.command,
        { cwd, shellPath },
      );
      const expected = await expectedTarget(f, action, "Dev");
      const grant = grantAtDispatch(f);
      let changed = false;
      f.events.subscribeNotify((event) => {
        if (event.type !== "launch.created") return;
        assert.ok(grant(), "publication must happen after final admission");
        changed = true;
        // These changes occur after admission but before the process adapter's async setup.
        process.env.NERVE_LAUNCH_ADMISSION_PROBE = "not admitted";
        f.settings.tools.bash.shellPath = "/unadmitted-shell";
        writeFileSync(join(cwd, ".envrc"), "# manager added after admission\n");
        writeFileSync(join(cwd, "direnv"), "#!/bin/sh\nexit 42\n", {
          mode: 0o755,
        });
      });
      const id = await request(f);
      await approve(f, id, `approve-${action}`);
      await completed(f, id);
      assert.equal(changed, true);
      assert.equal(f.launchSpawns.length, 1);
      const spawned = f.launchSpawns[0];
      assert.equal(grant()?.executionTargetDigest, expected.digest);
      // Boolean comparisons intentionally avoid printing secret-bearing environment snapshots.
      assert.ok(
        isDeepStrictEqual(spawned.options.preparedShell, expectedInvocation),
        "spawn must consume the exact admitted invocation/environment",
      );
      assert.deepEqual(
        spawned.options.preparedShell!.invocation.launch,
        expected.target.processLaunch,
      );
      assert.equal(
        spawned.options.shellPath,
        undefined,
        "the adapter must not forward late legacy shell settings",
      );
      assert.equal(
        spawned.options.env,
        undefined,
        "the adapter must not rebuild the prepared environment",
      );
      assert.equal(spawned.options.cwd, cwd);
      const running = (await f.launches.list())[0];
      assert.equal(running.status, "running");
      assert.equal(running.command, created.definition.command);
    },
  );
}

void test(
  "production standalone restart captures its environment/target before admission and preserves lineage",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t, [
      {
        type: "toolCall",
        id: "provider-launch",
        name: "launch",
        args: { action: "restart", name: "Ad hoc" },
      },
      { type: "waitForAbort" },
    ]);
    const cwd = f.project;
    const shellPath = await realpath("/bin/sh");
    const initial = await f.launches.start({
      projectId: "proj_admission",
      command: "standalone command",
      displayName: "Ad hoc",
      cwd,
      preparedShell: prepareShellProcess("standalone command", {
        cwd,
        shellPath,
      }),
    });
    f.launchSpawns.length = 0;
    await f.save({ permissionRuleSetId: "supervised" });
    const expected = await expectedTarget(f, "restart", "Ad hoc");
    const expectedInvocation = prepareShellProcess(initial.command, {
      cwd,
      shellPath,
    });
    const grant = grantAtDispatch(f);
    const id = await request(f);
    await approve(f, id, "approve-standalone");
    await completed(f, id);
    assert.equal(f.launchSpawns.length, 1);
    assert.equal(grant()?.executionTargetDigest, expected.digest);
    assert.ok(
      isDeepStrictEqual(
        f.launchSpawns[0].options.preparedShell,
        expectedInvocation,
      ),
    );
    const restarted = (await f.launches.list()).find(
      (launch) => launch.id !== initial.id,
    )!;
    assert.equal(restarted.restartedFromLaunchId, initial.id);
    assert.equal(restarted.restartRootLaunchId, initial.id);
    assert.equal(restarted.restartGeneration, 1);
    assert.equal(restarted.command, initial.command);
  },
);

void test(
  "production launch approval cannot silently substitute a changed command/cwd target",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t, [
      {
        type: "toolCall",
        id: "provider-launch",
        name: "launch",
        args: { action: "start", name: "Dev" },
      },
      { type: "waitForAbort" },
    ]);
    const initial = await definition(f, f.project);
    await f.save({ permissionRuleSetId: "supervised" });
    const id = await request(f);
    const changedCwd = join(f.project, "changed");
    await mkdir(changedCwd);
    await f.definitions.update(
      "proj_admission",
      initial.definition.id,
      {
        label: "Dev",
        command: "changed command",
        cwd: changedCwd,
        runPolicy: "single",
      },
      initial.revision,
    );
    await approve(f, id, "approve-old-target");
    const oldBinding =
      f.runtime.storage.toolCalls.get(id)!.supervision!.approval!;
    assert.ok(oldBinding);
    await until(() => {
      const call = f.runtime.storage.toolCalls.get(id);
      return (
        call?.state === "awaiting_approval" && !call.interaction?.resolution
      );
    });
    assert.equal(f.launchSpawns.length, 0);
    assert.equal(
      f.runtime.storage.toolCalls.get(id)?.supervision?.approval,
      undefined,
    );
    const expected = await expectedTarget(f, "start", "Dev");
    assert.notEqual(oldBinding.executionTargetDigest, expected.digest);
    const grant = grantAtDispatch(f);
    await approve(f, id, "approve-refreshed-target");
    await completed(f, id);
    assert.equal(f.launchSpawns.length, 1);
    assert.equal(f.launchSpawns[0].command, "changed command");
    assert.equal(f.launchSpawns[0].options.cwd, changedCwd);
    assert.equal(grant()?.executionTargetDigest, expected.digest);
  },
);

for (const action of ["start", "restart"] as const) {
  void test(
    `production launch ${action}: persisted approval is readmitted with fresh approval after restart changes the shell`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await productionAdmissionFixture(t, [
        {
          type: "toolCall",
          id: "provider-launch",
          name: "launch",
          args: { action, name: "Dev" },
        },
        { type: "waitForAbort" },
      ]);
      const created = await definition(f, f.project);
      if (action === "restart") {
        await f.launches.start({
          projectId: "proj_admission",
          definitionId: created.definition.id,
          command: "previous command",
          cwd: f.project,
          preparedShell: prepareShellProcess("previous command", {
            cwd: f.project,
            shellPath: await realpath("/bin/sh"),
          }),
        });
        f.launchSpawns.length = 0;
      }
      await f.save({ permissionRuleSetId: "supervised" });
      // /bin/sh and /bin/bash may be the same canonical executable. Use a genuinely
      // distinct executable identity rather than testing a spelling-only alias change.
      const alternateShell = join(f.home, "alternate-shell");
      await copyFile(await realpath("/bin/sh"), alternateShell);
      const id = await request(f);
      const expectedOld = await expectedTarget(f, action, "Dev");
      await approve(f, id, "approve-before-restart");
      const oldBinding =
        f.runtime.storage.toolCalls.get(id)!.supervision!.approval!;
      assert.ok(oldBinding);
      assert.equal(oldBinding.executionTargetDigest, expectedOld.digest);
      await f.restartWithShell(alternateShell);
      const refreshed = f.runtime.storage.toolCalls.get(id);
      assert.ok(
        refreshed,
        "Expected pending readmission for the changed shell target",
      );
      assert.equal(refreshed.state, "awaiting_approval");
      assert.equal(refreshed.supervision?.approval, undefined);
      assert.equal(refreshed.interaction?.resolution, undefined);
      assert.equal(f.launchSpawns.length, 0);
      const expected = await expectedTarget(f, action, "Dev", alternateShell);
      assert.notEqual(oldBinding.executionTargetDigest, expected.digest);
      const grant = grantAtDispatch(f);
      await approve(f, id, "approve-after-restart");
      await completed(f, id);
      assert.equal(f.launchSpawns.length, 1);
      assert.equal(grant()?.executionTargetDigest, expected.digest);
      assert.equal(
        f.launchSpawns[0].options.preparedShell!.invocation.launch.shell,
        await realpath(alternateShell),
      );
    },
  );
}

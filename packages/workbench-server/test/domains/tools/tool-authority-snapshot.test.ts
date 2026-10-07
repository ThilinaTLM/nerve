import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { buildToolService, agent } from "./tool-service-test-fixture.js";

it("preserves provider-turn cwd, readonly selection and scope through approval and restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-restart-"));
  const source = join(home, "source");
  const next = join(home, "next");
  await mkdir(source);
  await mkdir(next);
  const current = {
    ...agent("autonomous"),
    parentAgentId: "agent_parent",
    projectDir: source,
    workspaceScope: { roots: [source], readonly: false },
  };
  const original = buildToolService(home, current);
  t.after(async () => {
    await original.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const agentSnapshot = structuredClone(current);
  const permissionContext =
    await original.service.capturePermissionContext(agentSnapshot);
  const toolAuthority = await original.service.captureToolAuthority(
    agentSnapshot,
    permissionContext,
  );
  // Accepted edits during the provider request cannot rewrite its tool batch.
  current.projectDir = next;
  current.workspaceScope = { roots: [next], readonly: true };
  current.permissionLevel = "read_only";
  current.tools = ["read"];
  const pending = await original.service.requestTool(
    current,
    "write",
    { path: "result.txt", content: "original" },
    {
      agentSnapshot,
      permissionContext,
      toolAuthority,
      forceApproval: true,
      durableSuspend: true,
    },
  );
  assert.equal(pending.toolCall.status, "waiting");
  assert.equal(pending.toolCall.cwd, source);
  await original.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-original",
    },
    original.journalCommit,
  );
  // Another accepted scope/cwd edit after approval must not reinterpret that approval.
  const afterApproval = join(home, "after-approval");
  await mkdir(afterApproval);
  current.projectDir = afterApproval;
  current.workspaceScope = { roots: [afterApproval], readonly: true };
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  const stored = await restarted.service.getToolCallDetails(
    pending.toolCall.id,
  );
  assert.deepEqual(stored.authoritySnapshot?.workspaceScope, {
    roots: [source],
    readonly: false,
  });
  assert.equal(stored.authoritySnapshot?.cwd?.path, source);
  assert.equal(
    (await restarted.service.claimApprovedExecution(stored.id)).status,
    "running",
  );
  const nextTurn = await restarted.service.requestTool(current, "write", {
    path: "result.txt",
    content: "new",
  });
  assert.equal(nextTurn.toolCall.status, "denied");
});

it("pins original physical roots instead of adopting a swapped logical root", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-root-swap-"));
  const source = join(home, "original");
  const outside = join(home, "replacement");
  const alias = join(home, "source-link");
  await mkdir(source);
  await mkdir(outside);
  await symlink(source, alias, "dir");
  const current = {
    ...agent("autonomous"),
    parentAgentId: "agent_parent",
    projectDir: alias,
    workspaceScope: { roots: [alias] },
  };
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "read",
    { path: "file.txt" },
    { forceApproval: true, durableSuspend: true },
  );
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-read",
    },
    f.journalCommit,
  );
  assert.equal(
    pending.toolCall.authoritySnapshot?.workspaceRoots[0]?.physicalPath,
    source,
  );
  await rm(alias);
  await symlink(outside, alias, "dir");
  // Even granting the replacement location in ordinary config cannot repair the old authority.
  current.workspaceScope = { roots: [alias, outside] };
  await assert.rejects(
    f.service.claimApprovedExecution(pending.toolCall.id),
    /authority root changed.*symbolic link/,
  );
  assert.equal(f.service.getToolCall(pending.toolCall.id).phase, "drafted");
});

it("blocks target symlink replacement under original approval despite later scope expansion", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-target-swap-"));
  const source = join(home, "source");
  const outside = join(home, "outside");
  await mkdir(source);
  await mkdir(outside);
  const current = {
    ...agent("autonomous"),
    parentAgentId: "agent_parent",
    projectDir: source,
    workspaceScope: { roots: [source] },
  };
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "write",
    { path: "redirect/file.txt", content: "x" },
    { forceApproval: true, durableSuspend: true },
  );
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-write",
    },
    f.journalCommit,
  );
  current.workspaceScope = { roots: [source, outside] };
  await symlink(outside, join(source, "redirect"), "dir");
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  await assert.rejects(
    restarted.service.claimApprovedExecution(pending.toolCall.id),
    /symbolic link/,
  );
});

it("retains legacy approvals with a visible blocker when original physical scope is unknown", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-legacy-"));
  const current = {
    ...agent("autonomous"),
    projectDir: home,
    workspaceScope: { roots: [home] },
  };
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "write",
    { path: "file.txt", content: "x" },
    { forceApproval: true, durableSuspend: true },
  );
  const approved = await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-legacy",
    },
    f.journalCommit,
  );
  await f.journal.commit(current.conversationId, {
    kind: "test.legacy_authority",
    events: [
      {
        kind: "tool_call.upserted",
        conversationId: current.conversationId,
        toolCall: {
          ...approved.toolCall,
          revision: approved.toolCall.revision + 1,
          authoritySnapshot: undefined,
        },
      },
    ],
  });
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  await assert.rejects(
    restarted.service.claimApprovedExecution(pending.toolCall.id),
    /TOOL_AUTHORITY_SNAPSHOT_UNAVAILABLE/,
  );
  assert.equal(
    restarted.service.getToolCall(pending.toolCall.id).supervision?.status,
    "approved",
  );
});

it("keeps an original ordinary readonly selection for the in-flight batch even when next-turn config expands it", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-readonly-"));
  const current = {
    ...agent("autonomous"),
    projectDir: home,
    workspaceScope: { roots: [home], readonly: true },
  };
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const agentSnapshot = structuredClone(current);
  const permissionContext =
    await f.service.capturePermissionContext(agentSnapshot);
  const toolAuthority = await f.service.captureToolAuthority(
    agentSnapshot,
    permissionContext,
  );
  current.workspaceScope.readonly = false;
  const original = await f.service.requestTool(
    current,
    "write",
    { path: "file.txt", content: "x" },
    { agentSnapshot, permissionContext, toolAuthority },
  );
  assert.equal(original.toolCall.status, "denied");
  const next = await f.service.requestTool(
    current,
    "write",
    { path: "file.txt", content: "next" },
    { forceApproval: true, durableSuspend: true },
  );
  assert.equal(next.toolCall.status, "waiting");
});

it("rechecks explicit stop after asynchronous physical validation before granting the claim", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-authority-stop-race-"));
  const current = {
    ...agent("autonomous"),
    projectDir: home,
    workspaceScope: { roots: [home] },
  };
  let armed = false;
  let reads = 0;
  const f = buildToolService(
    home,
    current,
    undefined,
    undefined,
    undefined,
    () => {
      if (armed && ++reads === 2) current.activationState = "paused";
      return current;
    },
  );
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "write",
    { path: "file.txt", content: "x" },
    { forceApproval: true, durableSuspend: true },
  );
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-before-stop",
    },
    f.journalCommit,
  );
  armed = true;
  await assert.rejects(
    f.service.claimApprovedExecution(pending.toolCall.id),
    /paused/,
  );
  assert.equal(reads, 2);
  assert.equal(f.service.getToolCall(pending.toolCall.id).phase, "drafted");
});

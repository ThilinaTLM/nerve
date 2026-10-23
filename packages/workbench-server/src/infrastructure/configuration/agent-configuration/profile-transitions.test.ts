import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  openCoreStorage,
  type ProfileTransitionInput,
} from "@nervekit/conversation-core";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import { atomicReplaceFile } from "../../storage-bootstrap/file-mutations.js";
import { AgentConfigurationService } from "./agent-configuration-service.js";
import { bundledAgentProfiles } from "./builtins.js";
import { createProfileTransitions } from "./profile-transitions.js";

async function fixture(
  clampThinking?: (
    model: ModelSelection,
    level: ThinkingLevel,
  ) => ThinkingLevel,
) {
  const home = await mkdtemp(join(tmpdir(), "nerve-profile-transitions-"));
  const project = join(home, "project");
  await mkdir(project);
  await mkdir(join(home, "config"));
  await writeFile(
    join(home, "config", "agent.json"),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: {
        model: { provider: "test", modelId: "defaults" },
        reasoningLevel: "low",
        permissionRuleSetId: "autonomous",
      },
    }),
  );
  const storage = openCoreStorage(join(home, "test.sqlite"));
  const now = new Date().toISOString();
  storage.projects.insert({
    id: "p",
    name: "Project",
    directory: project,
    createdAt: now,
    updatedAt: now,
  });
  storage.conversations.insert(
    {
      id: "c",
      projectId: "p",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "Conversation",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      conversationId: "c",
      model: { provider: "obsolete", modelId: "obsolete" },
      reasoningLevel: "off",
      permissionRuleSetId: "baseline",
      agentProfile: "coding",
      systemPrompt: null,
      instructions: null,
      workingDirectory: project,
    },
  );
  let failWrite = false;
  let failPublication = false;
  const trusted = new Set<string>();
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => project,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {
      ...bundledAgentProfiles,
      locked: JSON.stringify({
        schemaVersion: 1,
        name: "locked",
        description: "Required model",
        usableBy: "lead",
        instructions: "Locked instructions",
        requirements: {
          model: { provider: "test", modelId: "required" },
          reasoningLevel: "high",
          permissionRuleSetId: "read_only",
        },
      }),
    },
    isProfileTrusted: (_id, _path, digest) => trusted.has(digest),
    captureResources: () => ({
      options: { referenceAvailable: () => true, clampThinking },
      isCurrent: () => true,
    }),
    io: {
      write: async (...args) => {
        if (failWrite) throw new Error("Injected persistence failure");
        return atomicReplaceFile(...args);
      },
      syncDirectory: async () => {
        if (failPublication) throw new Error("Injected publication failure");
        return "synchronized";
      },
    },
  });
  let lifecycle = createProfileTransitions(service);
  await service.createConversation("c", {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: null,
    overrides: {
      model: { provider: "test", modelId: "explicit" },
      permissionRuleSetId: "autonomous",
      tools: { plan_present: { enabled: true } },
    },
  });
  const confirmation = async (
    profile: string,
    id: string,
    kind: ProfileTransitionInput["kind"] = "profile",
  ): Promise<ProfileTransitionInput> => {
    const preview = await lifecycle.port.preview("c", profile);
    assert.equal(preview.status, "ready");
    if (preview.status !== "ready") throw new Error("Expected preview");
    return {
      conversationId: "c",
      kind,
      targetProfile: preview.preview.targetProfile,
      expectedRevision: preview.preview.expectedRevision,
      expectedDigest: preview.preview.expectedDigest,
      transitionId: id,
      ...(kind === "profile"
        ? { action: "switch" as const }
        : { toolCallId: "plan-call" }),
    };
  };
  const document = () =>
    readFile(
      service.paths.agent({ scope: "conversation", conversationId: "c" }),
      "utf8",
    ).then((bytes) => JSON.parse(bytes));
  return {
    service,
    storage,
    confirmation,
    document,
    get lifecycle() {
      return lifecycle;
    },
    restartLifecycle: () => {
      lifecycle = createProfileTransitions(service);
    },
    failWrite: (value: boolean) => {
      failWrite = value;
    },
    failPublication: (value: boolean) => {
      failPublication = value;
    },
    trust: (digest: string) => {
      trusted.add(digest);
      service.invalidateResources();
    },
    close: async () => {
      await service.flushSummaries();
      storage.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

void test("Planning to Coding replaces one contribution, preserving explicit choices and tool selections", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.lifecycle.port.apply(
          await f.confirmation("planning", "planning"),
        )
      ).status,
      "applied",
    );
    const planning = await f.service.getEffective("c");
    assert.equal(planning.status, "available");
    if (planning.status === "available")
      assert.equal(
        planning.resolution.settings.permissionRuleSetId,
        "planning",
      );
    const before = await f.document();
    const coding = await f.lifecycle.port.apply(
      await f.confirmation("coding", "coding"),
    );
    assert.equal(coding.status, "applied");
    const after = await f.document();
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.overrides, before.overrides);
    if (
      coding.status === "applied" &&
      coding.effective.status === "available"
    ) {
      assert.equal(
        coding.effective.resolution.settings.permissionRuleSetId,
        "autonomous",
      );
      assert.equal(
        coding.effective.resolution.settings.tools?.plan_present?.enabled,
        true,
      );
      assert.equal(
        coding.effective.resolution.settings.model?.modelId,
        "explicit",
      );
    }
  } finally {
    await f.close();
  }
});

void test("plan choices and profile snapshot commit in ONE CAS revision; conflicting/new stale choices remain refreshable", async () => {
  const f = await fixture();
  try {
    const input = await f.confirmation("locked", "bad-plan", "plan-approval");
    const bytes = await f.document();
    const conflict = await f.lifecycle.port.apply({
      ...input,
      choices: { model: { provider: "test", modelId: "different" } },
    });
    assert.equal(conflict.status, "refresh_required");
    if (conflict.status === "refresh_required")
      assert.equal(conflict.reason, "requirement_conflict");
    assert.deepEqual(await f.document(), bytes);
    // Runtime input is parsed strictly, not trusted because of the TypeScript type.
    await assert.rejects(
      f.lifecycle.port.apply({
        ...(await f.confirmation("locked", "escalating-plan", "plan-approval")),
        choices: {
          model: { provider: "test", modelId: "required" },
          permissionRuleSetId: "autonomous",
        } as unknown as ProfileTransitionInput["choices"],
      }),
    );
    assert.deepEqual(await f.document(), bytes);
    const accepted = await f.confirmation(
      "locked",
      "new-plan",
      "plan-approval",
    );
    assert.equal(
      (
        await f.lifecycle.port.apply({
          ...accepted,
          choices: {
            model: { provider: "test", modelId: "required" },
            reasoningLevel: "high",
          },
        })
      ).status,
      "applied",
    );
    const after = await f.document();
    assert.equal(after.revision, bytes.revision + 1);
    assert.equal(after.overrides.model.modelId, "required");
    assert.equal(after.overrides.reasoningLevel, "high");
    assert.equal(after.appliedProfile.name, "locked");
    // Approval can submit model/reasoning only; permissions originate from the target
    // requirement and the existing explicit override, never from submitted choices.
    assert.equal(
      after.overrides.permissionRuleSetId,
      bytes.overrides.permissionRuleSetId,
    );
    assert.equal(
      after.appliedProfile.requirements.permissionRuleSetId,
      "read_only",
    );
    const effective = await f.service.getEffective("c");
    if (effective.status !== "available")
      assert.fail("Expected effective configuration");
    assert.equal(
      effective.resolution.settings.permissionRuleSetId,
      "read_only",
    );
    assert.equal(after.lastTransition, undefined);
    assert.deepEqual(f.storage.events.since("c", 0), []);
    assert.equal(f.storage.conversations.get("c")?.headEventId, null);
    const source = await f.service.ensureLoaded({
      scope: "conversation",
      conversationId: "c",
    });
    if (source.status === "unavailable")
      throw new Error("Expected committed document");
    await f.service.save(source.value.scope, {
      expectedRevision: source.value.revision,
      expectedDigest: source.value.digest,
      changes: {},
      resets: [],
    });
  } finally {
    await f.close();
  }
});

void test("stale target bytes, current configuration changes, and untrusted shadows never silently substitute", async () => {
  const f = await fixture();
  try {
    const stale = await f.confirmation("coding", "stale-target");
    await f.service.profiles.save({ scope: "user" }, "coding", "missing", {
      schemaVersion: 1,
      name: "coding",
      description: "Updated coding",
      usableBy: "lead",
      instructions: "New instructions",
    });
    const changed = await f.lifecycle.port.apply(stale);
    assert.equal(changed.status, "refresh_required");
    if (changed.status === "refresh_required")
      assert.equal(changed.reason, "target_changed");
    const current = await f.confirmation("coding", "stale-config");
    await f.service.save(
      { scope: "conversation", conversationId: "c" },
      {
        expectedRevision: current.expectedRevision,
        expectedDigest: current.expectedDigest,
        changes: { reasoningLevel: "medium" },
        resets: [],
      },
    );
    const conflict = await f.lifecycle.port.apply(current);
    assert.equal(conflict.status, "refresh_required");
    if (conflict.status === "refresh_required")
      assert.equal(conflict.reason, "configuration_changed");
    const project = await f.service.profiles.save(
      { scope: "project", projectId: "p" },
      "coding",
      "missing",
      {
        schemaVersion: 1,
        name: "coding",
        description: "Project shadow",
        usableBy: "lead",
        instructions: "Project",
      },
    );
    const untrusted = await f.lifecycle.port.preview("c", "coding");
    assert.equal(untrusted.status, "refresh_required");
    if (untrusted.status === "refresh_required")
      assert.equal(untrusted.reason, "target_untrusted");
    f.trust(project.digest);
    assert.equal(
      (await f.lifecycle.port.preview("c", "coding")).status,
      "ready",
    );
  } finally {
    await f.close();
  }
});

void test("failed persistence leaves the file unchanged and stale retries require refresh", async () => {
  const f = await fixture();
  try {
    const input = await f.confirmation("coding", "failed-write");
    const before = await f.document();
    f.failWrite(true);
    await assert.rejects(f.lifecycle.port.apply(input), /persistence failure/);
    assert.deepEqual(await f.document(), before);
    f.failWrite(false);
    await f.service.save(
      { scope: "conversation", conversationId: "c" },
      {
        expectedRevision: input.expectedRevision,
        expectedDigest: input.expectedDigest,
        changes: { reasoningLevel: "medium" },
        resets: [],
      },
    );
    assert.equal(
      (await f.lifecycle.port.apply(input)).status,
      "refresh_required",
    );
    assert.equal(
      (
        await f.lifecycle.port.apply(
          await f.confirmation("coding", "fresh-write"),
        )
      ).status,
      "applied",
    );
  } finally {
    await f.close();
  }
});

void test("publication failure remains blocked until reload; lost-response retries need refresh", async () => {
  const f = await fixture();
  try {
    const input = await f.confirmation("coding", "publication");
    f.failPublication(true);
    assert.equal((await f.lifecycle.port.apply(input)).status, "unavailable");
    const committed = await f.document();
    assert.equal((await f.lifecycle.port.apply(input)).status, "unavailable");
    f.failPublication(false);
    await f.service.reload({ scope: "conversation", conversationId: "c" });
    f.restartLifecycle();
    assert.equal(
      (await f.lifecycle.port.apply(input)).status,
      "refresh_required",
    );
    assert.deepEqual(await f.document(), committed);
    assert.deepEqual(f.storage.events.since("c", 0), []);
    assert.equal(f.storage.conversations.get("c")?.headEventId, null);
  } finally {
    await f.close();
  }
});

void test("explicit reapply is digest-bound and replaces only the currently applied profile", async () => {
  const f = await fixture();
  try {
    await f.lifecycle.port.apply(
      await f.confirmation("coding", "initial-coding"),
    );
    const before = await f.document();
    await f.service.profiles.save({ scope: "user" }, "coding", "missing", {
      schemaVersion: 1,
      name: "coding",
      description: "Changed coding",
      usableBy: "lead",
      instructions: "New frozen instructions",
      requirements: { permissionRuleSetId: "read_only" },
    });
    assert.deepEqual(
      (await f.document()).appliedProfile,
      before.appliedProfile,
    );
    const wrongName = await f.confirmation("planning", "wrong-reapply");
    assert.equal(
      (await f.lifecycle.port.apply({ ...wrongName, action: "reapply" }))
        .status,
      "refresh_required",
    );
    assert.deepEqual(await f.document(), before);
    const input = await f.confirmation("coding", "reapply");
    assert.notEqual(
      input.targetProfile.digest,
      before.appliedProfile.sourceDigest,
    );
    assert.equal(
      (await f.lifecycle.port.apply({ ...input, action: "reapply" })).status,
      "applied",
    );
    const after = await f.document();
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.appliedProfile.instructions, "New frozen instructions");
    assert.deepEqual(after.overrides, before.overrides);
  } finally {
    await f.close();
  }
});

void test("D7 transitions accept cross-layer fitting but refresh same-layer invalid pairs and unsupported requirements", async () => {
  const f = await fixture((model, level) =>
    model.modelId === "no-reasoning" ? "off" : level,
  );
  try {
    const initial = await f.confirmation("coding", "before-reasoning");
    await f.service.save(
      { scope: "conversation", conversationId: "c" },
      {
        expectedRevision: initial.expectedRevision,
        expectedDigest: initial.expectedDigest,
        changes: { reasoningLevel: "high" },
        resets: [],
      },
    );
    const requiredModel = { provider: "test", modelId: "no-reasoning" };
    for (const name of ["fitted", "unsupported"])
      await f.service.profiles.save({ scope: "user" }, name, "missing", {
        schemaVersion: 1,
        name,
        description: name,
        usableBy: "lead",
        instructions: "",
        requirements: {
          model: requiredModel,
          ...(name === "unsupported" ? { reasoningLevel: "high" } : {}),
        },
      });
    const result = await f.lifecycle.port.apply({
      ...(await f.confirmation("fitted", "fitted-transition", "plan-approval")),
      choices: { reasoningLevel: "high" },
    });
    assert.equal(result.status, "applied");
    if (result.status !== "applied" || result.effective.status !== "available")
      throw new Error("Expected available fitted transition");
    assert.equal(result.effective.resolution.settings.reasoningLevel, "off");
    assert.deepEqual(
      result.effective.resolution.provenance["/reasoningLevel"],
      { source: "conversation", adjusted: true },
    );
    assert.deepEqual(result.effective.resolution.diagnostics, [
      { code: "reasoning-adjusted", pointer: "/reasoningLevel" },
    ]);
    const committed = await f.document();
    assert.equal(
      committed.overrides.reasoningLevel,
      "high",
      "Do not rewrite the authored choice to its fitted value",
    );
    for (const name of ["coding", "unsupported"]) {
      const blocked = await f.lifecycle.port.apply({
        ...(await f.confirmation(name, `blocked-${name}`, "plan-approval")),
        ...(name === "coding"
          ? {
              choices: {
                model: requiredModel,
                reasoningLevel: "high" as const,
              },
            }
          : {}),
      });
      assert.equal(blocked.status, "refresh_required");
      if (blocked.status === "refresh_required")
        assert.equal(blocked.reason, "requirement_conflict");
      assert.deepEqual(
        await f.document(),
        committed,
        "Blocked reasoning must not commit the profile or submitted choices",
      );
    }
  } finally {
    await f.close();
  }
});

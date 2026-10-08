/* eslint-disable max-lines -- Turn preparation scenarios share a deterministic mechanics/input fixture. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getRegisteredModels,
  getAgentModelInfo,
} from "@nervekit/harness/models";
import {
  agentRecordSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import {
  prepareWorkbenchTurn,
  createWorkbenchPreparationSession,
  dispatchWorkbenchTurn,
} from "../../../src/domains/agents/execution/workbench-turn-preparation.js";
import {
  AgentInputService,
  type AgentInputQueueState,
} from "../../../src/domains/runs/runtime/agent-inputs.js";
import type { WorkbenchAgentMechanics } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";
import { executeWorkbenchHarness } from "../../../src/domains/agents/execution/workbench-harness-execution.js";
import { Conversation } from "@nervekit/harness/conversation";
import { InMemoryConversationStorage } from "../../../../harness/src/conversation/adapters/in-memory-storage.js";
function fixture(home: string) {
  const modelA = getRegisteredModels("openai").find((model) =>
    getAgentModelInfo(model).supportedThinkingLevels.includes("off"),
  )!;
  const modelB = getRegisteredModels("anthropic").find((model) =>
    getAgentModelInfo(model).supportedThinkingLevels.includes("off"),
  )!;
  let current = agentRecordSchema.parse({
    id: "agent_child",
    conversationId: "conv_shared",
    projectId: "proj_test",
    projectDir: home,
    rootAgentId: "agent_parent",
    parentAgentId: "agent_parent",
    mode: "coding",
    permissionLevel: "read_only",
    workspaceScope: { roots: [home] },
    thinkingLevel: "off",
    model: { provider: modelA.provider, modelId: modelA.id },
    tools: ["read"],
    skills: [],
    instructions: "old instruction",
    systemPrompt: "old prompt",
    configurationRevision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  let resolveSelection = async () => ({
    disabledFileSkills: [],
    enabledNerveSkills: [],
    enabledAgentBrowserSkills: [],
  });
  const captured: AgentRecord[] = [];
  const authorities: AgentRecord[] = [];
  let authorityGate: (() => Promise<void>) | undefined;
  let defaultModel: AgentRecord["model"];
  let committed: AgentRecord | undefined;
  const mechanics = {
    customModels: async () => [],
    effectiveSettings: async () => ({ runtime: {}, defaultModel }),
    activeToolNamesFor: async () => ["read"],
    deps: {
      state: { agents: { get: () => current } },
      storage: {
        paths: { home },
        canonicalStore: {
          readDocument: async () =>
            committed ? { data: committed } : undefined,
        },
      },
      capabilities: { resolve: () => resolveSelection() },
      nerveSkills: { skills: [] },
      agentBrowserSkills: { skills: [] },
      tools: {
        captureToolAuthority: async (
          actor: AgentRecord,
          _context: unknown,
          options: { configurationProvenance: string },
        ) => {
          assert.equal(options.configurationProvenance, "resolved");
          assert.ok(
            actor.model && actor.permissionRuleSetId && actor.systemPrompt,
          );
          assert.ok(Array.isArray(actor.tools) && Array.isArray(actor.skills));
          authorities.push(structuredClone(actor));
          await authorityGate?.();
          return {};
        },
        capturePermissionContext: async (agent: AgentRecord) => {
          captured.push(agent);
          return {};
        },
      },
    },
  } as unknown as WorkbenchAgentMechanics;
  const coordinator = {
    run: { runId: "run_child", executionId: "exec_child" },
  } as never;
  const prepare = (
    turnId: string,
    conversation?: Parameters<typeof prepareWorkbenchTurn>[0]["conversation"],
    initialPromptHasImages = false,
    session?: Parameters<typeof prepareWorkbenchTurn>[0]["session"],
  ) =>
    prepareWorkbenchTurn({
      mechanics,
      conversation,
      initialPromptHasImages,
      session,
      agent: current,
      coordinator,
      runAbortController: new AbortController(),
      shellPath: undefined,
      turnId,
    });
  return {
    prepare,
    captured,
    authorities,
    mechanics,
    setCommitted: (actor: AgentRecord) => {
      committed = structuredClone(actor);
    },
    setAuthorityGate: (gate: () => Promise<void>) => {
      authorityGate = gate;
    },
    modelA,
    modelB,
    latest: () => current,
    setDefaultModel: (selection: AgentRecord["model"]) => {
      defaultModel = selection;
    },
    update: (patch: Partial<AgentRecord>) => {
      current = { ...current, ...patch };
    },
    blockSelection: (callback: typeof resolveSelection) => {
      resolveSelection = callback;
    },
  };
}
test("turn preparation adopts one complete committed snapshot, including provider, tools, prompt, cwd, and permission", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-turn-"));
  try {
    const harness = fixture(home);
    await mkdir(join(home, "next"));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.blockSelection(async () => {
      entered();
      await gate;
      return {
        disabledFileSkills: [],
        enabledNerveSkills: [],
        enabledAgentBrowserSkills: [],
      };
    });
    const preparing = harness.prepare("turn_one");
    await ready;
    harness.update({
      model: { provider: harness.modelB.provider, modelId: harness.modelB.id },
      projectDir: join(home, "next"),
      permissionLevel: "supervised",
      mode: "planning",
      instructions: "new instruction",
      systemPrompt: "new prompt",
      tools: [],
      configurationRevision: 2,
    });
    release();
    const inFlightSnapshot = await preparing;
    assert.equal(inFlightSnapshot.model.provider, harness.modelB.provider);
    assert.deepEqual(inFlightSnapshot.activeToolNames, []);
    assert.equal(inFlightSnapshot.effective.configurationRevision, 2);
    assert.equal(inFlightSnapshot.env.cwd, join(home, "next"));
    assert.match(inFlightSnapshot.systemPrompt, /new instruction/);
    assert.equal(
      harness.captured[0]?.permissionLevel,
      "read_only",
      "superseded resource resolution was discarded",
    );
    assert.equal(harness.captured[1]?.permissionLevel, "supervised");
    harness.update({
      permissionLevel: "autonomous",
      tools: ["read"],
      configurationRevision: 3,
      instructions: "third instruction",
    });
    const next = await harness.prepare("turn_two");
    assert.equal(next.effective.configurationRevision, 3);
    assert.deepEqual(next.activeToolNames, ["read"]);
    assert.match(next.systemPrompt, /third instruction/);
    assert.equal(
      inFlightSnapshot.effective.configuration.permissionLevel,
      "supervised",
    );
    assert.match(inFlightSnapshot.systemPrompt, /new instruction/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("unavailable models and configured skills block instead of silently falling back", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-blocker-"));
  try {
    const harness = fixture(home);
    harness.update({
      model: { provider: "not-a-provider", modelId: "not-a-model" },
    });
    await assert.rejects(
      harness.prepare("turn_invalid"),
      /Configured model is unavailable/,
    );
    harness.update({
      model: harness.latest().model && {
        provider: harness.modelA.provider,
        modelId: harness.modelA.id,
      },
      skills: ["missing-skill"],
    });
    await assert.rejects(
      harness.prepare("turn_invalid_skill"),
      /Configured skills are unavailable/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("null skill selection inherits nonempty project resources, empty disables, named subset and default model resolve", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-inheritance-"));
  try {
    const dir = join(home, ".nerve", "skills", "hello");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: hello\ndescription: Useful test skill\n---\nHello instruction\n",
    );
    const harness = fixture(home);
    harness.setDefaultModel({
      provider: harness.modelB.provider,
      modelId: harness.modelB.id,
    });
    harness.update({ skills: null, model: undefined });
    const inherited = await harness.prepare("inherit");
    assert.ok(inherited.effective.configuration.skills?.includes("hello"));
    assert.equal(inherited.model.id, harness.modelB.id);
    harness.update({ skills: [] });
    assert.deepEqual(
      (await harness.prepare("none")).effective.configuration.skills,
      [],
    );
    harness.update({ skills: ["hello"] });
    assert.deepEqual(
      (await harness.prepare("named")).effective.configuration.skills,
      ["hello"],
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("physical resolved authority capture gates preparation and unsupported specific effort blocks", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-authority-"));
  try {
    const harness = fixture(home);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.setAuthorityGate(async () => {
      entered();
      await gate;
    });
    let prepared = false;
    const preparing = harness.prepare("authority").then((value) => {
      prepared = true;
      return value;
    });
    await ready;
    assert.equal(prepared, false);
    assert.equal(harness.authorities.length, 1);
    release();
    const snapshot = await preparing;
    assert.equal(harness.authorities[0]?.systemPrompt, snapshot.systemPrompt);
    assert.deepEqual(
      harness.authorities[0]?.tools,
      snapshot.effective.configuration.tools,
    );
    const unsupported = getRegisteredModels("openai").find(
      (model) =>
        model.reasoning &&
        !getAgentModelInfo(model).supportedThinkingLevels.includes("max"),
    );
    assert.ok(unsupported);
    harness.update({
      model: { provider: unsupported.provider, modelId: unsupported.id },
      thinkingLevel: "max",
      configurationRevision: 2,
    });
    await assert.rejects(
      harness.prepare("unsupported-effort"),
      /reasoning effort is unsupported/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("committed configuration beats stale cache; late inputs cannot cross the captured batch cutoff", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-cutoff-"));
  try {
    const harness = fixture(home);
    const docs = new Map<string, AgentInputQueueState>();
    let id = 0;
    const queue = new AgentInputService(
      {
        load: async (key) => structuredClone(docs.get(key)),
        save: async (key, state) => {
          docs.set(key, structuredClone(state));
        },
      },
      { next: () => String(++id) },
      { now: () => new Date() },
    );
    harness.mechanics.deps.agentInputs = queue;
    const inserted: string[] = [];
    harness.mechanics.deps.harnessStorage = {
      appendAgentMessageWithId: async (_actor: unknown, entryId: string) => {
        inserted.push(entryId);
      },
      openAgentStorage: async () => ({
        getEntry: async () => undefined,
        getEntries: async () => [],
      }),
    } as never;
    harness.mechanics.deps.messageMirror = {
      mirrorNewHarnessEntries: async () => [],
    } as never;
    const accept = (key: string) =>
      queue.accept(
        "agent_child",
        "conv_shared",
        {
          text: key,
          role: "user",
          origin: { kind: "user", userId: "user" },
          idempotencyKey: key,
          eligibility: { kind: "next_turn" },
          activation: "queue_only",
        },
        async () => undefined,
      );
    const first = await accept("before-cut");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    harness.blockSelection(async () => {
      entered();
      await gate;
      return {
        disabledFileSkills: [],
        enabledNerveSkills: [],
        enabledAgentBrowserSkills: [],
      };
    });
    let compactedFor = "";
    harness.mechanics.maybeAutoCompactBeforeQueuedTurn = async (input) => {
      assert.equal(inserted.length, 0);
      assert.equal(input.actor?.model?.provider, harness.modelB.provider);
      compactedFor = input.text;
      return { status: "not_needed", reason: "below_threshold" };
    };
    const session = createWorkbenchPreparationSession("cut");
    const context = { buildContext: async () => ({ messages: [] }) } as never;
    const preparing = harness.prepare("cut", context, false, session);
    await ready;
    harness.setCommitted({
      ...harness.latest(),
      configurationRevision: 2,
      model: { provider: harness.modelB.provider, modelId: harness.modelB.id },
      instructions: "committed new instructions",
    });
    const late = await accept("after-cut");
    release();
    const snapshot = await preparing;
    assert.equal(snapshot.effective.configurationRevision, 2);
    assert.equal(snapshot.model.provider, harness.modelB.provider);
    assert.match(snapshot.systemPrompt, /committed new instructions/);
    assert.deepEqual(inserted, [`entry_${first.id}`]);
    assert.equal(
      compactedFor,
      "before-cut",
      "preventive compaction considers the selected model and only this pending batch before insertion",
    );
    assert.deepEqual(
      (await queue.list("agent_child")).map((input) => input.id),
      [late.id],
    );
    const remaining = session.budget.remaining;
    harness.mechanics.maybeAutoCompactBeforeQueuedTurn = async () => ({
      status: "not_needed",
      reason: "below_threshold",
    });
    session.supersessions++;
    const refreshed = await harness.prepare("cut", context, false, session);
    assert.equal(refreshed.effective.turnId, snapshot.effective.turnId);
    assert.equal(session.budget.remaining, remaining);
    assert.deepEqual(inserted, [`entry_${first.id}`]);
    assert.deepEqual(
      (await queue.list("agent_child")).map((input) => input.id),
      [late.id],
    );
    session.supersessions = 8;
    await assert.rejects(
      harness.prepare("cut", context, false, session),
      (error) => {
        assert.equal(
          (error as { configurationRevision: number }).configurationRevision,
          2,
        );
        return /changed too frequently/.test(String(error));
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("foreign committed actor scope cannot create tools or insert another agent's context", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-actor-scope-"));
  try {
    const h = fixture(home);
    h.setCommitted({ ...h.latest(), id: "agent_other" });
    await assert.rejects(h.prepare("foreign"), /context scope is corrupt/);
    assert.equal(h.authorities.length, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("stop winning before the actual dispatch barrier preserves delivered but undispatched context", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-undispatched-"));
  try {
    const h = fixture(home);
    let state: AgentInputQueueState | undefined;
    const queue = new AgentInputService(
      {
        load: async () => structuredClone(state),
        save: async (_id, next) => {
          state = structuredClone(next);
        },
      },
      { next: () => "one" },
      { now: () => new Date() },
    );
    await queue.accept(
      "agent_child",
      "conv_shared",
      {
        text: "must reach a provider",
        role: "user",
        origin: { kind: "user", userId: "user" },
        idempotencyKey: "one",
        eligibility: { kind: "next_turn" },
        activation: "queue_only",
      },
      async () => undefined,
    );
    await queue.prepare(
      {
        agentId: "agent_child",
        conversationId: "conv_shared",
        runId: "run_child",
        attemptId: "exec_child",
        turnId: "prepared_child",
      },
      async () => undefined,
      async () => false,
    );
    h.mechanics.deps.agentInputs = queue;
    const prepared = await h.prepare("prepared");
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.mechanics.deps.claimPreparedTurn = async (_agent, commit, dispatch) => {
      entered();
      await gate;
      await commit();
      await dispatch();
      return { kind: "ready" };
    };
    const coordinator = {
      sink: { recordEffectiveTurnConfiguration: async () => undefined },
    } as never;
    const dispatching = dispatchWorkbenchTurn(
      h.mechanics,
      prepared.effective,
      () => "turn_actual",
      coordinator,
      new AbortController().signal,
      h.latest(),
    );
    const rejected = assert.rejects(
      dispatching,
      /dispatch is paused or cancelled/,
    );
    await ready;
    await queue.setPaused("agent_child", true);
    release();
    await rejected;
    assert.deepEqual(await queue.list("agent_child"), []);
    assert.equal(await queue.hasContextPending("agent_child"), true);
    await queue.setPaused("agent_child", false, true);
    assert.equal(await queue.hasWakeRequest("agent_child"), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("unsupported config committed during insertion retains durable undispatched input and exact failed revision", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-invalid-after-insert-"));
  try {
    const h = fixture(home);
    let state: AgentInputQueueState | undefined;
    const queue = new AgentInputService(
      {
        load: async () => structuredClone(state),
        save: async (_id, next) => {
          state = structuredClone(next);
        },
      },
      { next: () => "one" },
      { now: () => new Date() },
    );
    h.mechanics.deps.agentInputs = queue;
    const input = await queue.accept(
      "agent_child",
      "conv_shared",
      {
        text: "must not disappear",
        role: "user",
        origin: { kind: "user", userId: "user" },
        idempotencyKey: "one",
        eligibility: { kind: "next_turn" },
        activation: "queue_only",
      },
      async () => undefined,
    );
    let inserted = 0;
    h.mechanics.deps.harnessStorage = {
      appendAgentMessageWithId: async () => {
        inserted++;
        h.setCommitted({
          ...h.latest(),
          configurationRevision: 2,
          model: { provider: "unsupported", modelId: "unavailable" },
        });
      },
      openAgentStorage: async () => ({
        getEntry: async () => undefined,
        getEntries: async () => [],
      }),
    } as never;
    h.mechanics.deps.messageMirror = {
      mirrorNewHarnessEntries: async () => [],
    } as never;
    await assert.rejects(
      h.prepare("invalid-insertion"),
      (error) =>
        error instanceof Error &&
        "configurationRevision" in error &&
        error.configurationRevision === 2,
    );
    assert.equal(inserted, 1);
    assert.equal(
      (await queue.get("agent_child", input.id))?.state,
      "delivered",
    );
    assert.equal(await queue.hasContextPending("agent_child"), true);
    await queue.setPaused("agent_child", true);
    const reopened = new AgentInputService(
      {
        load: async () => structuredClone(state),
        save: async (_id, next) => {
          state = structuredClone(next);
        },
      },
      { next: () => "unused" },
      { now: () => new Date() },
    );
    await reopened.setPaused("agent_child", false, true);
    assert.equal(await reopened.hasWakeRequest("agent_child"), true);
    assert.equal(await reopened.hasContextPending("agent_child"), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("configuration-only model changes still compact against the resolved window before dispatch", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-config-compaction-"));
  try {
    const h = fixture(home);
    const documents = new Map<string, AgentInputQueueState>();
    h.mechanics.deps.agentInputs = new AgentInputService({
      load: async (id) => documents.get(id),
      save: async (id, state) => {
        documents.set(id, structuredClone(state));
      },
    });
    h.setCommitted({
      ...h.latest(),
      configurationRevision: 2,
      model: { provider: h.modelB.provider, modelId: h.modelB.id },
    });
    const calls: string[] = [];
    h.mechanics.maybeAutoCompactBeforeQueuedTurn = async (input) => {
      assert.deepEqual(input.actor?.model, {
        provider: h.modelB.provider,
        modelId: h.modelB.id,
      });
      assert.equal(input.text, "");
      assert.deepEqual(input.images, []);
      calls.push("resolved compaction");
      return { status: "compacted", reason: "checkpoint_committed" };
    };
    const turn = await h.prepare("config-only", {
      buildContext: async () => ({ messages: [] }),
    } as never);
    calls.push("prepared");
    assert.equal(turn.model.provider, h.modelB.provider);
    assert.deepEqual(calls, ["resolved compaction", "prepared"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("turn preparation blocks text-only models for original and retained context images", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-images-"));
  try {
    const harness = fixture(home);
    const model = getRegisteredModels("openai").find(
      (candidate) =>
        !candidate.input.includes("image") &&
        getAgentModelInfo(candidate).supportedThinkingLevels.includes("off"),
    );
    assert.ok(model, "registry includes a text-only model");
    harness.update({
      model: { provider: model.provider, modelId: model.id },
      configurationRevision: 2,
    });
    await assert.rejects(
      harness.prepare("turn_original_image", undefined, true),
      /Selected model does not support input images/,
    );
    const conversation = new Conversation(new InMemoryConversationStorage());
    await conversation.appendMessage({
      role: "user",
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      timestamp: Date.now(),
    });
    await assert.rejects(
      harness.prepare("turn_retained_image", conversation),
      /Selected model does not support input images/,
    );
    const firstKeptEntryId = await conversation.appendMessage({
      role: "user",
      content: "continue after summarizing the image",
      timestamp: Date.now(),
    });
    await conversation.appendCompaction(
      "Image described in text",
      firstKeptEntryId,
      100,
    );
    const prepared = await harness.prepare(
      "turn_compacted_text_only",
      conversation,
    );
    assert.equal(prepared.model.id, model.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("initial harness preparation preserves configuration blockers and accepted inputs", async (t) => {
  const textOnlyModel = getRegisteredModels("openai").find(
    (candidate) =>
      !candidate.input.includes("image") &&
      getAgentModelInfo(candidate).supportedThinkingLevels.includes("off"),
  );
  assert.ok(textOnlyModel);
  for (const scenario of [
    {
      name: "original image with a text-only model",
      model: { provider: textOnlyModel.provider, modelId: textOnlyModel.id },
      message: /does not support input images/,
    },
    {
      name: "unavailable committed model",
      model: { provider: "unsupported", modelId: "unavailable" },
      message: /Configured model is unavailable/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const home = await mkdtemp(join(tmpdir(), "nerve-402-initial-blocker-"));
      try {
        const h = fixture(home);
        const startingAgent = h.latest();
        h.setCommitted({
          ...startingAgent,
          model: scenario.model,
          configurationRevision: 2,
        });
        const docs = new Map<string, AgentInputQueueState>();
        const queue = new AgentInputService(
          {
            load: async (id) => structuredClone(docs.get(id)),
            save: async (id, state) => {
              docs.set(id, structuredClone(state));
            },
          },
          { next: () => "initial-input" },
          { now: () => new Date() },
        );
        h.mechanics.deps.agentInputs = queue;
        const accepted = await queue.accept(
          startingAgent.id,
          startingAgent.conversationId,
          {
            text: "accepted input must survive the blocker",
            role: "user",
            origin: { kind: "user", userId: "user" },
            idempotencyKey: "initial",
            eligibility: { kind: "next_turn" },
            activation: "queue_only",
          },
          async () => undefined,
        );
        const storage = new InMemoryConversationStorage();
        let attempted = false;
        let credentialRequests = 0;
        Object.assign(h.mechanics.deps.state, {
          getConversation: () => ({ id: startingAgent.conversationId }),
        });
        Object.assign(h.mechanics.deps, {
          logger: { info: async () => undefined },
          harnessStorage: { openAgentStorage: async () => storage },
          subscriptionUsage: { touchProvider: () => undefined },
          auth: {
            requestAuthForPiModel: async () => {
              credentialRequests++;
              throw new Error("Provider credentials must not be requested");
            },
          },
        });
        h.mechanics.executeInlinePromptBlockCommand = async () =>
          assert.fail("Blocked preparation must never execute shell work");
        h.mechanics.runHarnessAttempt = async ({ harness, request }) => {
          attempted = true;
          assert.deepEqual((await storage.buildContext()).messages, []);
          try {
            return await harness.prompt(request.text, {
              images: request.images,
            });
          } catch (error) {
            // An edit after failed preparation must not relabel its blocker.
            h.setCommitted({ ...startingAgent, configurationRevision: 3 });
            throw error;
          }
        };
        const outcome = await executeWorkbenchHarness.call(
          h.mechanics,
          startingAgent,
          {
            text: "describe this image",
            images: [
              { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            ],
          },
          {
            coordinator: {
              run: {
                runId: "run_child",
                executionId: "exec_child",
                initialInputId: accepted.id,
              },
              installControl: () => undefined,
              signal: new AbortController().signal,
            } as never,
          },
        );
        assert.equal(attempted, true, "execution reached the real harness");
        assert.equal(outcome.status, "failed");
        assert.ok("failure" in outcome);
        assert.equal(outcome.failure.code, "AGENT_CONFIGURATION_BLOCKED");
        assert.equal(outcome.failure.retryable, false);
        assert.match(outcome.failure.message, scenario.message);
        const blocker = await queue.admissionBlocker(startingAgent.id);
        assert.equal(blocker?.configurationRevision, 2);
        assert.match(blocker!.message, scenario.message);
        assert.deepEqual(await queue.list(startingAgent.id), [accepted]);
        assert.equal(credentialRequests, 0);
        assert.deepEqual((await storage.buildContext()).messages, []);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});

test("superseded dispatch candidate never allocates live turn or binds input, effective snapshot, or provider dispatch", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-stale-claim-"));
  try {
    const h = fixture(home);
    const prepared = await h.prepare("stable-prepared");
    let effects = 0;
    h.mechanics.deps.claimPreparedTurn = async () => ({ kind: "refresh" });
    h.mechanics.deps.agentInputs = {
      isPaused: async () => false,
      bindTurn: async () => {
        effects++;
      },
      recordProviderDispatch: async () => {
        effects++;
      },
    } as never;
    const result = await dispatchWorkbenchTurn(
      h.mechanics,
      prepared.effective,
      () => {
        effects++;
        return "never-live";
      },
      {
        sink: {
          recordEffectiveTurnConfiguration: async () => {
            effects++;
          },
        },
      } as never,
      new AbortController().signal,
      h.latest(),
    );
    assert.deepEqual(result, { kind: "refresh" });
    assert.equal(effects, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

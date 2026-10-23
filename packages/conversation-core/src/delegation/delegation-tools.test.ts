import type { AgentProfilePort } from "../ports.js";
import {
  withTestAdmission,
  withTestPreparation,
} from "../runtime/test-admission.js";
import { testConfiguration } from "../runtime/configuration-test-helper.js";
import { profilePort } from "../runtime/lifecycle-test-helpers.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import type { AgentScriptedProviderStep } from "@nervekit/harness/models";
import { SUBAGENT_REPORT_INLINE_BYTES } from "@nervekit/contracts/subagents";
import { ConversationCore } from "../core.js";
import { openCoreStorage } from "../storage/core-storage.js";
import {
  createDelegationTools,
  type SubagentHost,
} from "./delegation-tools.js";

const LEAD = "conv_lead";
type Step = AgentScriptedProviderStep;
const profiles = ["explore", "developer", "waiter"];

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for core state");
}

/** One lead and its sub-agents, each model turn answered from a per-provider script queue. */
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "nerve-delegation-"));
  const storage = openCoreStorage(":memory:");
  const script = new Map<string, Step[]>();
  const handles: { unregister(): void }[] = [];
  const turnHandles = new Map<
    string,
    ReturnType<typeof registerAgentScriptedProvider>
  >();
  let peek = 0;
  let turns = 0;
  const peekHandle = registerAgentScriptedProvider({
    provider: `peek-${randomUUID()}`,
    model: "test",
    steps: [],
  });
  handles.push(peekHandle);
  const initialized: { parentId: string; childId: string; profile: string }[] =
    [];
  const host: SubagentHost = {
    usableProfiles: async () => profiles,
    resolveProfile: async ({ profile }) => {
      if (!profiles.includes(profile))
        throw new Error(
          `Unknown profile "${profile}". Usable: ${profiles.join(", ")}`,
        );
      return {
        name: profile,
        application: {
          config: {
            agentProfile: profile,
            model: { provider: `child-${profile}`, modelId: "test" },
            reasoningLevel: "low",
            permissionRuleSetId:
              profile === "developer" ? "autonomous" : "read_only",
          },
          applied: {
            schemaVersion: 1,
            name: profile,
            instructions: `Instructions for ${profile}`,
            locked: {},
          },
        },
      };
    },
  };
  const snapshots = profilePort();
  const hostProfiles: AgentProfilePort = {
    ...profilePort(),
    async persistApplication(childId, application) {
      await snapshots.persistApplication(childId, application);
      if (childId === LEAD) return;
      const profile = application.applied.name;
      initialized.push({ parentId: LEAD, childId, profile });
      if (profile === "waiter")
        storage.asyncBash.insert({
          id: `bash_${childId}`,
          conversationId: childId,
          toolCallId: "tool_background",
          command: "pnpm test",
          workingDirectory: dataDir,
          status: "running",
          processRef: null,
          exitCode: null,
          startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          finishedAt: null,
        });
    },
    getAppliedProfile: (id) => snapshots.getAppliedProfile(id),
  };
  const configuration = testConfiguration(
    { prepare: async () => ({ systemPrompt: "Test", tools: [] }) },
    (id) => storage.conversations.getContext(id)!,
  );
  const prepareCreation = configuration.prepareCreation;
  configuration.prepareCreation = async (input) => ({
    ...(await prepareCreation(input)),
    ...(input.application?.config ?? {
      model: { provider: "lead", modelId: "test" },
    }),
    workingDirectory: dataDir,
  });
  configuration.initializeConversation = async (input) => {
    const config =
      input.application?.config ??
      (
        await hostProfiles.applyProfile({
          conversation: {
            projectId: input.projectId,
            parentConversationId: null,
          },
          config: {
            model: { provider: "lead", modelId: "test" },
            reasoningLevel: "off",
            permissionRuleSetId: "baseline",
            agentProfile: "coding",
            instructions: null,
            systemPrompt: null,
            workingDirectory: dataDir,
          },
          projectDir: dataDir,
        })
      ).config;
    configuration.update(input.id, {
      ...config,
      instructions: null,
      systemPrompt: null,
    });
    await hostProfiles.persistApplication(input.id, {
      config,
      applied: {
        schemaVersion: 1,
        name: config.agentProfile,
        instructions: `Instructions for ${config.agentProfile}`,
        locked: {},
      },
    });
  };
  const core = new ConversationCore({
    configuration,
    storage,
    dataDir,
    models: {
      resolve: async (selection) => {
        if (peek) return { model: peekHandle.getModel("test")! };
        // A turn resolves the model more than once; reuse its scripted step until consumed.
        const current = turnHandles.get(selection.provider);
        if (current && current.getPendingResponseCount() > 0)
          return { model: current.getModel("test")! };
        const step: Step = script.get(selection.provider)?.shift() ?? {
          type: "assistantText",
          text: "idle",
        };
        const handle = registerAgentScriptedProvider({
          provider: `${selection.provider}-${++turns}-${randomUUID()}`,
          model: "test",
          steps: [step],
        });
        handles.push(handle);
        turnHandles.set(selection.provider, handle);
        return { model: handle.getModel("test")! };
      },
    },
    toolHost: withTestPreparation({
      execute: async () => ({
        kind: "completed",
        result: { content: "file text" },
      }),
      isReplaySafe: () => false,
    }),
    permissions: withTestAdmission({
      evaluate: async () => ({
        decision: "allow",
        suggestedRules: [],
        authority: null,
      }),
      addRule: async () => {},
    }),
    processes: {
      start: async () => {
        throw new Error("No process expected");
      },
      run: async () => {
        throw new Error("No process expected");
      },
      reattach: async () => null,
    },
    defaultConfig: () => ({
      model: { provider: "lead", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: "Lead prompt",
      instructions: "Lead instructions",
      permissionRuleSetId: "baseline",
      agentProfile: "coding",
      workingDirectory: dataDir,
    }),
  });
  for (const handler of createDelegationTools(core, host))
    core.registerCoreTool(
      handler.definition.name === "subagent_status"
        ? {
            ...handler,
            execute: async (call, ctx) => {
              peek++;
              try {
                return await handler.execute(call, ctx);
              } finally {
                peek--;
              }
            },
          }
        : handler,
    );
  await core.start();
  core.projects.create({ id: "proj_test", name: "Test", directory: tmpdir() });
  await core.createConversation({ id: LEAD, projectId: "proj_test" });
  const queue = (provider: string, ...steps: Step[]) => {
    script.set(provider, [...(script.get(provider) ?? []), ...steps]);
  };
  const responses = () =>
    storage.events
      .since(LEAD, 0)
      .flatMap((event) =>
        event.type === "tool_call_response" ? [event.payload] : [],
      );
  const notices = () =>
    core
      .getEventsSince(LEAD, 0)
      .flatMap((event) =>
        event.type === "system_event" &&
        event.payload.subtype === "sub_conversation_event"
          ? [event.payload.text]
          : [],
      );
  /** Has the lead call a tool and returns its result text. */
  const lead = async (name: string, args: Record<string, unknown>) => {
    const before = responses().length;
    queue("lead", {
      type: "toolCall",
      id: `call_${randomUUID()}`,
      name,
      args,
    });
    core.submitInput({
      conversationId: LEAD,
      inputId: `input_${randomUUID()}`,
      text: "go",
      source: "user",
    });
    await waitUntil(() => responses().length > before);
    await waitUntil(
      () => core.getSnapshot(LEAD).conversation.status === "idle",
    );
    const response = responses()[before];
    return {
      toolCallId: response.toolCallId,
      outcome: response.outcome,
      preview: response.userProjection?.resultPreview,
      text: response.agentProjection
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n"),
    };
  };
  const child = (name: string) => {
    const found = core
      .getSnapshot(LEAD)
      .children.find((row) => row.title === name);
    assert.ok(found, `child ${name}`);
    return found;
  };
  const idle = (name: string) => () =>
    core.getSnapshot(child(name).id).conversation.status === "idle";
  return {
    core,
    configuration,
    dataDir,
    initialized,
    host,
    queue,
    lead,
    child,
    notices,
    idle,
    async cleanup() {
      await core.close();
      for (const handle of handles) handle.unregister();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
const explore = (prompt = "do it", name = "a") => ({
  assignments: [{ name, profile: "explore", prompt }],
});

void test("creates a child from the profile, initializes it and assigns context plus prompt", async () => {
  const f = await fixture();
  try {
    f.queue("child-explore", { type: "assistantText", text: "child report" });
    const result = await f.lead("subagent_prompt", {
      context: "shared",
      assignments: [{ name: "a", profile: "explore", prompt: "do it" }],
    });
    assert.deepEqual(
      { outcome: result.outcome, text: result.text },
      {
        outcome: "completed",
        text: "a (explore): created",
      },
    );
    const created = f.child("a");
    const snapshot = f.core.getSnapshot(created.id);
    const config = await f.configuration.resolveConfig(
      created.id,
      snapshot.config,
    );
    assert.equal(config.model.provider, "child-explore");
    assert.equal(config.reasoningLevel, "low");
    assert.equal(config.permissionRuleSetId, "read_only");
    assert.equal(snapshot.config.instructions, null);
    // Legacy SQL/profile snapshots are not configuration authority.
    assert.equal(snapshot.appliedAgentProfile, null);
    assert.equal(snapshot.config.systemPrompt, null);
    assert.equal(config.agentProfile, "explore");
    assert.equal(
      (
        await f.configuration.resolveConfig(
          LEAD,
          f.core.getSnapshot(LEAD).config,
        )
      ).agentProfile,
      "coding",
    );
    assert.deepEqual(f.initialized, [
      { parentId: LEAD, childId: created.id, profile: "explore" },
    ]);
    await waitUntil(() => f.notices().length === 1);
    assert.equal(
      f.notices()[0],
      'Sub-agent "a" (explore) completed.\nchild report',
    );
    const message = f.core
      .getEventsSince(created.id, 0)
      .find((event) => event.type === "user_message");
    assert.equal(
      message?.type === "user_message" && message.payload.text,
      "shared\n\ndo it",
    );
  } finally {
    await f.cleanup();
  }
});

void test("initialized children keep configuration and follow-ups do not resolve or reapply changed profiles", async () => {
  const f = await fixture();
  try {
    const resolve = f.host.resolveProfile;
    let resolutions = 0;
    f.host.resolveProfile = async (input) => {
      resolutions++;
      return resolve(input);
    };
    f.queue("child-explore", { type: "assistantText", text: "first" });
    const created = await f.lead("subagent_prompt", explore());
    assert.equal(created.outcome, "completed");
    await waitUntil(f.idle("a"));
    const id = f.child("a").id;
    const config = f.core.getSnapshot(id).config;
    f.host.resolveProfile = async () => {
      resolutions++;
      throw new Error("Profile was removed");
    };
    f.host.usableProfiles = async () => [];
    for (const assignment of [
      { name: "a", profile: "explore", prompt: "again" },
      { name: "a", prompt: "without profile" },
    ]) {
      f.queue("child-explore", { type: "assistantText", text: "follow-up" });
      const result = await f.lead("subagent_prompt", {
        assignments: [assignment],
      });
      assert.equal(result.outcome, "completed");
      assert.match(result.text, /follow-up queued/);
      await waitUntil(f.idle("a"));
      assert.deepEqual(f.core.getSnapshot(id).config, config);
    }
    assert.equal(resolutions, 1);

    assert.deepEqual(f.initialized, [
      { parentId: LEAD, childId: id, profile: "explore" },
    ]);
  } finally {
    await f.cleanup();
  }
});

void test("rejects the whole batch with every reason and creates nothing", async () => {
  const f = await fixture();
  try {
    const result = await f.lead("subagent_prompt", {
      assignments: [
        { name: "x", profile: "explore", prompt: "p" },
        { name: "X", profile: "explore", prompt: "p" },
        { name: "y", prompt: "p" },
        { name: "z", profile: "nope", prompt: "p" },
      ],
    });
    assert.equal(result.outcome, "failed");
    assert.match(result.text, /X: duplicate name/);
    assert.match(result.text, /y: profile is required/);
    assert.match(result.text, /z: Unknown profile "nope"/);
    const assignments = (
      result.preview as {
        details: {
          assignments: Array<{
            name: string;
            disposition: string;
            reason: string;
          }>;
        };
      }
    ).details.assignments;
    assert.deepEqual(
      assignments.map((item) => [item.name, item.disposition]),
      [
        ["x", "rejected"],
        ["X", "rejected"],
        ["y", "rejected"],
        ["z", "rejected"],
      ],
    );
    assert.ok(
      assignments.every((item) => item.reason.includes("Unknown profile")),
    );
    assert.equal(f.core.getSnapshot(LEAD).children.length, 0);
    assert.equal(f.initialized.length, 0);
  } finally {
    await f.cleanup();
  }
});

void test("follow-ups queue, resume stopped children and reject a profile mismatch", async () => {
  const f = await fixture();
  try {
    f.queue("child-explore", { type: "assistantText", text: "first" });
    await f.lead("subagent_prompt", explore());
    await waitUntil(() => f.notices().length === 1);
    await waitUntil(f.idle("a"));
    const id = f.child("a").id;

    f.queue("child-explore", { type: "assistantText", text: "second" });
    const followUp = await f.lead("subagent_prompt", {
      assignments: [{ name: "A", profile: "explore", prompt: "again" }],
    });
    assert.equal(followUp.text, "A (explore): follow-up queued (idle)");
    await waitUntil(() => f.notices().length === 2);
    assert.match(f.notices()[1], /completed\.\nsecond$/);
    await waitUntil(f.idle("a"));

    const events = f.core.getEventsSince(id, 0).length;
    const mismatch = await f.lead("subagent_prompt", {
      assignments: [{ name: "a", profile: "developer", prompt: "nope" }],
    });
    assert.equal(mismatch.outcome, "failed");
    assert.match(
      mismatch.text,
      /is a explore sub-agent; profile developer does not match/,
    );
    assert.equal(f.core.getEventsSince(id, 0).length, events);

    await f.core.stop(id);
    assert.equal(f.core.getSnapshot(id).conversation.paused, true);
    f.queue("child-explore", { type: "assistantText", text: "third" });
    const resumed = await f.lead("subagent_prompt", explore("wake up"));
    assert.equal(resumed.text, "a (explore): follow-up queued (resumed)");
    assert.equal(f.core.getSnapshot(id).conversation.paused, false);
    await waitUntil(() => f.notices().length === 3);
    assert.match(f.notices()[2], /completed\.\nthird$/);
  } finally {
    await f.cleanup();
  }
});

void test("notices follow the stop source: user notifies, lead tool and cascade do not", async () => {
  const f = await fixture();
  try {
    const running = (name: string) => () =>
      f.core.getSnapshot(f.child(name).id).conversation.status === "running";
    // One at a time: concurrent turns would share the scripted provider queue.
    for (const name of ["b", "c", "d"]) {
      f.queue("child-explore", { type: "waitForAbort" });
      await f.lead("subagent_prompt", explore("work", name));
      await waitUntil(running(name));
    }

    await f.core.stop(f.child("b").id);
    await waitUntil(() => f.notices().length === 1);
    assert.match(
      f.notices()[0],
      /^Sub-agent "b" \(explore\) was stopped by the user\./,
    );

    const stopped = await f.lead("subagent_stop", { names: ["c", "ghost"] });
    assert.equal(stopped.text, "c: stopped\nghost: not found");
    const results = (
      stopped.preview as {
        details: {
          results: Array<{ name: string; outcome: string; runMs?: number }>;
        };
      }
    ).details.results;
    assert.equal(results[0]!.outcome, "stopped");
    assert.ok(typeof results[0]!.runMs === "number" && results[0]!.runMs >= 0);
    assert.deepEqual(results[1], { name: "ghost", outcome: "not_found" });
    await delay(100);
    assert.equal(f.notices().length, 1);

    await f.core.stop(LEAD);
    await delay(100);
    assert.equal(f.core.getSnapshot(f.child("d").id).conversation.paused, true);
    assert.equal(f.notices().length, 1);
  } finally {
    await f.cleanup();
  }
});

void test("failed executions and waiting background commands are reported", async () => {
  const f = await fixture();
  try {
    f.queue("child-explore", {
      type: "providerError",
      message: "boom",
      retryable: false,
    });
    f.queue("child-waiter", { type: "assistantText", text: "partial" });
    await f.lead("subagent_prompt", {
      assignments: [
        { name: "f", profile: "explore", prompt: "p" },
        { name: "w", profile: "waiter", prompt: "p" },
      ],
    });
    await waitUntil(() => f.notices().length === 2);
    const all = f.notices().join("\n---\n");
    assert.match(all, /Sub-agent "f" \(explore\) failed: .*boom/);
    assert.match(
      all,
      /Sub-agent "w" \(waiter\) is waiting on 1 background command and accepts follow-ups:\n"pnpm test" running 3m\npartial/,
    );
  } finally {
    await f.cleanup();
  }
});

void test("long final responses are truncated and spilled to the report file", async () => {
  const f = await fixture();
  try {
    const long = "x".repeat(SUBAGENT_REPORT_INLINE_BYTES + 4000);
    f.queue("child-explore", { type: "assistantText", text: long });
    await f.lead("subagent_prompt", explore());
    await waitUntil(() => f.notices().length === 1);
    const id = f.child("a").id;
    const notice = f.notices()[0];
    const match = /\[truncated; full response: (.+)\]$/.exec(notice);
    assert.ok(match);
    assert.ok(
      match[1].startsWith(join(f.dataDir, "conversations", id, "reports")),
    );
    assert.ok(match[1].endsWith(".md") && existsSync(match[1]));
    assert.equal(readFileSync(match[1], "utf8"), long);
    assert.ok(notice.length < long.length);
    await waitUntil(f.idle("a"));
    const status = await f.lead("subagent_status", { name: "a" });
    const full = await f.core.getToolCallDetails(LEAD, status.toolCallId);
    assert.ok(
      String(full.result.content).includes(
        `[truncated; full response: ${match[1]}]`,
      ),
    );
  } finally {
    await f.cleanup();
  }
});

void test("status lists children and shows final responses or recent activity", async () => {
  const f = await fixture();
  try {
    f.queue("child-explore", { type: "assistantText", text: "answer" });
    await f.lead("subagent_prompt", explore("quick", "e"));
    await waitUntil(() => f.notices().length === 1);
    await waitUntil(f.idle("e"));
    f.queue(
      "child-explore",
      {
        type: "toolCall",
        id: "call_read",
        name: "read",
        args: { path: "src/a.ts" },
      },
      { type: "waitForAbort" },
    );
    await f.lead("subagent_prompt", explore("long", "g"));
    const busy = f.child("g").id;
    await waitUntil(() =>
      f.core
        .getEventsSince(busy, 0)
        .some((event) => event.type === "tool_call_response"),
    );

    const list = await f.lead("subagent_status", {});
    assert.match(
      list.text,
      /^g · explore · running · ctx (\d+%|n\/a) · active \d+s ago$/m,
    );
    assert.match(
      list.text,
      /^e · explore · idle · ctx (\d+%|n\/a) · \d+s ago$/m,
    );

    const idle = await f.lead("subagent_status", { name: "e" });
    assert.match(idle.text, /^e · explore · .* · idle · ctx /);
    assert.match(idle.text, /\nFinal response:\nanswer$/);

    const active = await f.lead("subagent_status", { name: "g" });
    assert.match(
      active.text,
      /· running · .* · run \d+s\nRecent activity:\n✓ read src\/a\.ts$/,
    );
  } finally {
    await f.cleanup();
  }
});

void test("sub-agents reject user input", async () => {
  const f = await fixture();
  try {
    await f.lead("subagent_prompt", explore());
    const id = f.child("a").id;
    assert.throws(
      () =>
        f.core.submitInput({
          conversationId: id,
          inputId: "input_user",
          text: "hello",
          source: "user",
        }),
      /do not accept user input/,
    );
  } finally {
    await f.cleanup();
  }
});

void test("delegation details survive durable previews for create, follow-up, status and stop", async () => {
  const f = await fixture();
  try {
    const created = await f.lead("subagent_prompt", explore());
    const details = (value: unknown) =>
      (value as { details: Record<string, Array<Record<string, unknown>>> })
        .details;
    assert.deepEqual(details(created.preview).assignments, [
      {
        name: "a",
        profile: "explore",
        disposition: "created",
        agentId: f.child("a").id,
      },
    ]);
    await waitUntil(f.idle("a"));
    f.core.contextUsage = async () => ({
      tokens: 37,
      window: 100,
      percent: 37,
    });
    const status = await f.lead("subagent_status", {});
    const agent = details(status.preview).agents![0]!;
    assert.equal(agent.name, "a");
    assert.equal(agent.agentId, f.child("a").id);
    assert.equal(agent.state, "idle");
    assert.equal(agent.contextPercent, 37);
    assert.ok(
      typeof agent.lastActivityAt === "string" &&
        Number.isFinite(Date.parse(agent.lastActivityAt)),
    );
    const followUp = await f.lead("subagent_prompt", {
      assignments: [{ name: "a", prompt: "again" }],
    });
    assert.equal(
      details(followUp.preview).assignments![0]!.disposition,
      "follow_up",
    );
    await waitUntil(f.idle("a"));
    const stopped = await f.lead("subagent_stop", { names: ["a", "unknown"] });
    assert.deepEqual(details(stopped.preview).results, [
      { name: "a", outcome: "already_idle" },
      { name: "unknown", outcome: "not_found" },
    ]);
  } finally {
    await f.cleanup();
  }
});

void test("rejected batches identify every requested assignment", async () => {
  const f = await fixture();
  try {
    const prompt = createDelegationTools(f.core, f.host).find(
      (handler) => handler.definition.name === "subagent_prompt",
    )!;
    await assert.rejects(
      prompt.execute(
        {
          conversationId: LEAD,
          arguments: {
            assignments: [
              { name: "a", profile: "missing", prompt: "work" },
              { name: "b", profile: "explore", prompt: "work" },
            ],
          },
        } as never,
        {} as never,
      ),
      (error: unknown) => {
        const details = (
          error as Error & {
            details: {
              assignments: Array<{
                name: string;
                disposition: string;
                reason: string;
              }>;
            };
          }
        ).details;
        assert.deepEqual(
          details.assignments.map((item) => [item.name, item.disposition]),
          [
            ["a", "rejected"],
            ["b", "rejected"],
          ],
        );
        assert.ok(
          details.assignments.every((item) =>
            item.reason.includes("Unknown profile"),
          ),
        );
        return true;
      },
    );
    assert.equal(f.core.getSnapshot(LEAD).children.length, 0);
  } finally {
    await f.cleanup();
  }
});

void test("failed stop attempts retain a per-name outcome and reason", async () => {
  const f = await fixture();
  const stop = f.core.stop.bind(f.core);
  try {
    f.queue("child-explore", { type: "waitForAbort" });
    await f.lead("subagent_prompt", explore());
    await waitUntil(
      () =>
        f.core.getSnapshot(f.child("a").id).conversation.status === "running",
    );
    f.core.stop = async () => {
      throw new Error("cannot stop");
    };
    const result = await f.lead("subagent_stop", { names: ["a"] });
    const stopped = (
      result.preview as {
        details: {
          results: Array<{ outcome: string; reason: string; runMs?: number }>;
        };
      }
    ).details.results[0]!;
    assert.equal(stopped.outcome, "failed");
    assert.equal(stopped.reason, "cannot stop");
    assert.ok(typeof stopped.runMs === "number" && stopped.runMs >= 0);
  } finally {
    f.core.stop = stop;
    await f.cleanup();
  }
});

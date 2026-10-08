import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentRequestSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import { agentMethodHandlers } from "../../../src/adapters/protocol/handlers/agent-method-handlers.js";
import { SqliteIdempotencyStore } from "../../../src/adapters/protocol/sqlite-idempotency-store.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

test("actual root/child creation returns canonical agent DTOs and replays durably without duplicate actors/events", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-agent-create-idempotency-"));
  const storage = await initializeStorage(home);
  const fixture = createRuntimeFixture(storage, "127.0.0.1", 0);
  t.after(async () => {
    await shutdownServerRuntime(fixture.runtime);
    await storage.canonicalStore.close().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  });
  await fixture.lifecycle.hydrate();
  const project = await fixture.services.projectLifecycle.createProject({
    dir: home,
  });
  const conversation =
    await fixture.services.conversationLifecycle.createConversation({
      projectId: project.id,
    });
  const createdEvents: string[] = [];
  const unsubscribe = fixture.runtime.events.subscribe((event) => {
    if (event.type === "agent.created")
      createdEvents.push((event.data as { agent: AgentRecord }).agent.id);
  });
  t.after(unsubscribe);
  const state = {
    agentLifecycle: fixture.services.agentLifecycle,
    agentInterventions: fixture.services.agentInterventions,
  } as Parameters<(typeof agentMethodHandlers)["agent.create"]>[0];
  const store = new SqliteIdempotencyStore(storage.canonicalStore);
  const receipts: {
    key: string;
    params: ReturnType<typeof createAgentRequestSchema.parse>;
    outcome: unknown;
  }[] = [];
  let parentId: string | undefined;
  let executions = 0;
  for (const kind of ["root", "child"] as const) {
    const params = createAgentRequestSchema.parse({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "browser-live-provider", modelId: "original" },
      thinkingLevel: "off",
      executionKind: kind === "root" ? "explore" : "async_developer",
      permissionLevel: kind === "root" ? "autonomous" : "read_only",
      permissionRuleSetId: kind === "root" ? "autonomous" : "read_only",
      ...(kind === "root"
        ? { tools: ["explore"] }
        : {
            parentAgentId: parentId,
            name: "Live developer evidence",
            orchestrationPolicy: {
              preset: "developer",
              parentCancellation: "independent",
              completionReporting: "parent",
            },
          }),
    });
    assert.equal("executionKind" in params, false);
    const key = `create-${kind}`;
    const operation = async () => {
      executions++;
      return {
        status: "success" as const,
        result: await agentMethodHandlers["agent.create"](state, params),
      };
    };
    const first = await store.execute(
      "ui",
      key,
      "agent.create",
      params,
      operation,
    );
    assert.equal(
      first.outcome?.status,
      "success",
      JSON.stringify({
        outcome: first.outcome,
        undefinedFields: fixture.services.agentLifecycle
          .listAgents()
          .map((agent) =>
            Object.entries(agent)
              .filter(([, value]) => value === undefined)
              .map(([key]) => key),
          ),
      }),
    );
    assert.ok(first.outcome?.status === "success");
    const { agent } = first.outcome.result as { agent: AgentRecord };
    if (kind === "root") parentId = agent.id;
    const internal = fixture.services.agentLifecycle.getAgent(agent.id);
    assert.ok(
      Object.values(internal).some((value) => value === undefined),
      "real lifecycle records retain optional undefined properties internally",
    );
    assert.deepEqual(agent, JSON.parse(JSON.stringify(internal)));
    assert.equal(Object.hasOwn(agent, "systemPrompt"), false);
    assert.equal(Object.hasOwn(agent, "executionKind"), false);
    assert.equal(
      agent.orchestrationPolicy?.preset,
      kind === "root" ? "standard" : "developer",
    );
    assert.equal(agent.parentAgentId, kind === "root" ? undefined : parentId);
    const duplicate = await store.execute(
      "ui",
      key,
      "agent.create",
      params,
      operation,
    );
    assert.equal(duplicate.status, "replayed");
    assert.deepEqual(duplicate.outcome, first.outcome);
    receipts.push({ key, params, outcome: first.outcome });
  }
  const configured = await store.execute(
    "ui",
    "configure-root",
    "agent.configure",
    { agentId: parentId, instructions: "Accepted current settings" },
    async () => ({
      status: "success",
      result: await agentMethodHandlers["agent.configure"](state, {
        agentId: parentId!,
        instructions: "Accepted current settings",
      }),
    }),
  );
  assert.equal(
    configured.outcome?.status,
    "success",
    JSON.stringify(configured.outcome),
  );
  assert.ok(configured.outcome?.status === "success");
  assert.deepEqual(Object.keys(configured.outcome.result as object), ["agent"]);
  const configuredAgent = (configured.outcome.result as { agent: AgentRecord })
    .agent;
  assert.equal(configuredAgent.configurationAcceptances?.length, 1);
  assert.deepEqual(
    configuredAgent,
    JSON.parse(
      JSON.stringify(fixture.services.agentLifecycle.getAgent(parentId!)),
    ),
    "nested accepted configuration must have canonical JSON optional-property semantics",
  );
  assert.deepEqual(
    await agentMethodHandlers["agent.get"](state, { agentId: parentId! }),
    { agent: configuredAgent },
  );
  assert.equal(executions, 2);
  assert.equal(fixture.services.agentLifecycle.listAgents().length, 2);
  assert.equal(new Set(createdEvents).size, 2);
  assert.equal(createdEvents.length, 2);
  assert.deepEqual(await agentMethodHandlers["agent.list"](state, {}), {
    agents: fixture.services.agentLifecycle
      .listAgents()
      .map((agent) => JSON.parse(JSON.stringify(agent))),
  });
  await shutdownServerRuntime(fixture.runtime);
  await storage.canonicalStore.close();
  const reopened = new CanonicalStore(storage.paths.sqlitePath);
  await reopened.initialize();
  t.after(() => reopened.close());
  for (const receipt of receipts) {
    const replay = await new SqliteIdempotencyStore(reopened).execute(
      "ui",
      receipt.key,
      "agent.create",
      receipt.params,
      async () => {
        assert.fail("durable replay must not create another actor");
      },
    );
    assert.equal(replay.status, "replayed");
    assert.deepEqual(replay.outcome, receipt.outcome);
  }
  const configuredReplay = await new SqliteIdempotencyStore(reopened).execute(
    "ui",
    "configure-root",
    "agent.configure",
    { agentId: parentId, instructions: "Accepted current settings" },
    async () => {
      assert.fail("replay must not create another acceptance receipt");
    },
  );
  assert.deepEqual(configuredReplay.outcome, configured.outcome);
  assert.equal(configuredReplay.status, "replayed");
  assert.equal(createdEvents.length, 2);
  assert.equal((await reopened.listDocuments("agent", "global")).length, 2);
});

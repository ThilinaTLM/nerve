import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { AgentRecord, ToolCallRecord } from "@nerve/shared";
import { EventBus } from "../src/events.js";
import { PlanService } from "../src/plan-service.js";
import type { InitializedStorage } from "../src/storage.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-plan-service-"));
  roots.push(root);
  let currentAgent = agent();
  const storage = {
    paths: {
      home: root,
      configPath: join(root, "config.json"),
      daemonPath: join(root, "daemon.json"),
      sqlitePath: join(root, "state.sqlite"),
      localTokenPath: join(root, "auth", "local-token"),
    },
    settings: {} as InitializedStorage["settings"],
    localToken: "nt_test",
  } satisfies InitializedStorage;
  const events = new EventBus(root);
  const plans = new PlanService(
    storage,
    events,
    () => currentAgent,
    async (_agentId, mode) => {
      currentAgent = { ...currentAgent, mode };
      return currentAgent;
    },
  );
  return { root, plans, get agent() { return currentAgent; } };
}

describe("PlanService", () => {
  it("writes plan files using the agent-selected slug", async () => {
    const { plans, agent } = await fixture();
    const result = await plans.writePlan(agent, {
      slug: "plan-mode-lifecycle",
      content: "# Plan\n",
    });

    assert.equal(result.slug, "plan-mode-lifecycle");
    assert.equal(result.planPath.endsWith("plan-mode-lifecycle.md"), true);
    assert.equal(await readFile(result.planPath, "utf8"), "# Plan\n");
  });

  it("rejects unsafe slugs", async () => {
    const { plans, agent } = await fixture();
    await assert.rejects(
      plans.writePlan(agent, { slug: "../escape", content: "# Plan\n" }),
      /slug/,
    );
    await assert.rejects(
      plans.writePlan(agent, { slug: "with space", content: "# Plan\n" }),
      /slug/,
    );
  });

  it("presents a plan, resolves with feedback, and switches to coding on acceptance", async () => {
    const fx = await fixture();
    await fx.plans.writePlan(fx.agent, {
      slug: "accepted-plan",
      content: "# Accepted\n",
    });

    const pending = fx.plans.presentPlan(
      toolCall(),
      fx.agent,
      { slug: "accepted-plan" },
    );
    let review = fx.plans.listPlanReviews("pending")[0];
    for (let attempt = 0; !review && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      review = fx.plans.listPlanReviews("pending")[0];
    }
    assert.ok(review);
    assert.equal(review.slug, "accepted-plan");
    assert.equal(review.content, "# Accepted\n");

    await fx.plans.acceptPlanReview(review.id, "Looks good.");
    const result = await pending;
    assert.equal(result.outcome, "accepted");
    assert.equal(result.feedback, "Looks good.");
    assert.equal(fx.agent.mode, "coding");
  });
});

function agent(): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    sessionId: "ses_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "planning",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function toolCall(): ToolCallRecord {
  return {
    id: "tool_01HN0000000000000000000000",
    agentId: "agent_01HN0000000000000000000000",
    sessionId: "ses_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    toolName: "plan_mode_present",
    risk: "interaction",
    args: { slug: "accepted-plan" },
    cwd: "/tmp/project",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

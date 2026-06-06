import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  return {
    root,
    plans,
    get agent() {
      return currentAgent;
    },
  };
}

describe("PlanService", () => {
  it("presents a plan file, resolves with feedback, and switches to coding on acceptance", async () => {
    const fx = await fixture();
    const planPath = join(fx.plans.planDir(fx.agent), "accepted-plan.md");
    await mkdir(fx.plans.planDir(fx.agent), { recursive: true });
    await writeFile(planPath, "# Accepted\n", "utf8");

    const pending = fx.plans.presentPlan(toolCall(planPath), fx.agent, {
      file_path: planPath,
    });
    let review = fx.plans.listPlanReviews("pending")[0];
    for (let attempt = 0; !review && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      review = fx.plans.listPlanReviews("pending")[0];
    }
    assert.ok(review);
    assert.equal(review.slug, "accepted-plan");
    assert.equal(review.planPath, planPath);
    assert.equal(review.content, "# Accepted\n");

    await fx.plans.acceptPlanReview(review.id, "Looks good.");
    const result = await pending;
    assert.equal(result.outcome, "accepted");
    assert.equal(result.feedback, "Looks good.");
    assert.match(result.contentBlocks?.[0]?.text ?? "", /source of truth/);
    assert.equal(fx.agent.mode, "coding");
  });

  it("rejects a presented plan without switching out of planning mode", async () => {
    const fx = await fixture();
    const planPath = join(fx.plans.planDir(fx.agent), "rejected-plan.md");
    await mkdir(fx.plans.planDir(fx.agent), { recursive: true });
    await writeFile(planPath, "# Rejected\n", "utf8");

    const pending = fx.plans.presentPlan(toolCall(planPath), fx.agent, {
      file_path: planPath,
    });
    let review = fx.plans.listPlanReviews("pending")[0];
    for (let attempt = 0; !review && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      review = fx.plans.listPlanReviews("pending")[0];
    }
    assert.ok(review);

    await fx.plans.rejectPlanReview(review.id, "Not yet.");
    const result = await pending;
    assert.equal(result.outcome, "changes_requested");
    assert.equal(result.feedback, "Not yet.");
    assert.match(result.contentBlocks?.[0]?.text ?? "", /Plan rejected/);
    assert.equal(fx.agent.mode, "planning");
  });

  it("rejects plan files outside the plan directory", async () => {
    const fx = await fixture();
    const outside = join(fx.root, "outside.md");
    await writeFile(outside, "# Outside\n", "utf8");
    await assert.rejects(
      fx.plans.presentPlan(toolCall(outside), fx.agent, { file_path: outside }),
      /inside/,
    );
  });

  it("rejects empty plans and unresolved markers", async () => {
    const fx = await fixture();
    const planDir = fx.plans.planDir(fx.agent);
    await mkdir(planDir, { recursive: true });
    const empty = join(planDir, "empty.md");
    await writeFile(empty, "\n", "utf8");
    await assert.rejects(
      fx.plans.presentPlan(toolCall(empty), fx.agent, { file_path: empty }),
      /empty/,
    );

    const unresolved = join(planDir, "unresolved.md");
    await writeFile(unresolved, "# Plan\n\n[!QUESTION] Decide this.\n", "utf8");
    await assert.rejects(
      fx.plans.presentPlan(toolCall(unresolved), fx.agent, {
        file_path: unresolved,
      }),
      /unresolved/,
    );
  });
});

function agent(): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
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

function toolCall(planPath: string): ToolCallRecord {
  return {
    id: "tool_01HN0000000000000000000000",
    agentId: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    toolName: "plan_mode_present",
    risk: "interaction",
    args: { file_path: planPath },
    cwd: "/tmp/project",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

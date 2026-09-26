/**
 * Seeds a throwaway Nerve home with synthetic demo data for website
 * screenshots.
 *
 * Run with tsx, never against a real home:
 *
 *   NERVE_HOME=/tmp/nerve-demo-home \
 *   NERVE_DEMO_WORKSPACE=/tmp/nerve-demo-workspace \
 *   pnpm --filter @nervekit/workbench-server exec tsx scripts/seed-demo-home.ts
 *
 * The script refuses to run unless both paths live under the system temp
 * directory, so a mistyped variable cannot touch ~/.nerve or a real project.
 *
 * Data is written through the same lifecycle services the daemon uses — no raw
 * SQL — so the seeded home is a legitimate home rather than a lookalike.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createId } from "@nervekit/contracts";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { composeServerRuntime } from "../src/app/runtime/server-runtime.js";
import { shutdownServerRuntime } from "../src/app/runtime/server-runtime.js";
import {
  initializeStorage,
  type InitializedStorage,
} from "../src/infrastructure/storage-bootstrap/index.js";
import { ToolCallRepository } from "../src/domains/tools/artifacts/tool-call.repository.js";
import { TaskRepository } from "../src/domains/tasks/persistence/task.repository.js";
import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts/tasks";
import {
  DEMO_PROJECT_CONVERSATIONS,
  type DemoConversation,
  type DemoStep,
} from "./demo-data/conversations.js";
import {
  addPublicPullRequestRepo,
  createDemoWorkspace,
  DEMO_PROJECTS,
} from "./demo-data/workspace.js";

/**
 * A plausible model selection so the composer does not advertise the built-in
 * faux development model. Nothing is ever sent to the provider: the seed only
 * writes records.
 */
const DEMO_MODEL = { provider: "anthropic", modelId: "claude-sonnet-4-5" };

/**
 * Relative clock: timestamps are anchored to the seed run so the workbench
 * renders "2h ago" rather than a date that ages into "7mo ago" the moment the
 * fixture is a few months old.
 */
const SEED_NOW = Date.now();

function assertThrowaway(label: string, path: string): string {
  const resolved = resolve(path);
  const temp = resolve(tmpdir());
  if (!resolved.startsWith(`${temp}/`)) {
    throw new Error(
      `${label} must live under ${temp} for screenshot seeding; refusing to touch ${resolved}.`,
    );
  }
  return resolved;
}

function at(hoursAgo: number, offsetSeconds = 0): string {
  return new Date(
    SEED_NOW - hoursAgo * 3_600_000 + offsetSeconds * 1000,
  ).toISOString();
}

type Services = ReturnType<typeof composeServerRuntime>["services"];

interface SeedContext {
  readonly services: Services;
  readonly toolCalls: ToolCallRepository;
  readonly projectId: string;
  readonly workspace: string;
}

/**
 * Appends one demo step. Tool steps need two records: a transcript entry that
 * anchors the card at the right position, and the durable tool-call record the
 * card is rendered from.
 *
 * `lineage` reports whether the new entry can parent later entries. System
 * entries (tool anchors, compaction notices) are transcript-only and are not
 * mirrored into the harness tree, so they must not become parents — the next
 * real message continues from the last mirrored entry instead.
 */
async function appendStep(
  context: SeedContext,
  options: {
    conversationId: string;
    agentId: string;
    runId: string;
    parentEntryId: string | null;
    step: DemoStep;
    createdAt: string;
    tokensBefore: number;
  },
): Promise<{ entryId: string; lineage: boolean }> {
  const { services, toolCalls, projectId, workspace } = context;
  const { conversationId, agentId, runId, parentEntryId, step, createdAt } =
    options;

  if (step.type === "tool") {
    const toolCallId = createId("tool");
    /* Real runs anchor a tool card to a placeholder assistant message through
     * `liveMessageId`; the seed uses the same mechanism so the transcript and
     * history graph pair them exactly as they would after a live run. */
    const liveMessageId = createId("msg");
    const cwd = step.repo ? `${workspace}/${step.repo}` : workspace;
    const record: ToolCallRecord = {
      id: toolCallId,
      agentId,
      conversationId,
      projectId,
      toolName: step.toolName,
      runId,
      liveMessageId,
      contentIndex: 0,
      risk: step.risk,
      args: step.args,
      argsPreview: step.args,
      cwd,
      status: "completed",
      revision: 1,
      attempt: 1,
      interactions: [],
      result: step.result,
      resultPreview: step.result,
      createdAt,
      updatedAt: createdAt,
      settledAt: createdAt,
    } as ToolCallRecord;
    await toolCalls.create(record);
    /* The anchor is an assistant entry rather than a system one: system
     * entries are not mirrored into the harness tree, so they cannot carry
     * lineage and would fall outside the active branch the transcript reads.
     * Its text is never displayed — the timeline replaces the entry with the
     * tool card. */
    const entry = await services.conversationLifecycle.appendEntry({
      conversationId,
      agentId,
      runId,
      parentEntryId,
      role: "assistant",
      liveMessageId,
      text: `[Tool call: ${step.toolName}]`,
      details: { toolRecordId: toolCallId, toolName: step.toolName },
      createdAt,
    });
    return { entryId: entry.id, lineage: true };
  }

  const shared = {
    conversationId,
    agentId,
    runId,
    parentEntryId,
    createdAt,
    tokensBefore: options.tokensBefore,
  };

  if (step.type === "task_event") {
    /* The seed builds an explicit active branch. Use a mirrored anchor so the
     * notice participates in that branch; transcript projection still renders
     * `task_event` entries as system notices, matching a live notification. */
    const entry = await services.conversationLifecycle.appendEntry({
      ...shared,
      role: "assistant",
      kind: "task_event",
      text: step.text,
      details: {
        type: "task_event",
        taskName: step.taskName,
        event: step.event,
        status: step.status,
        commandPreview: step.commandPreview,
        command: step.command,
        output: step.output,
        exitCode: step.exitCode,
      },
    });
    return { entryId: entry.id, lineage: true };
  }

  if (step.type === "user") {
    const entry = await services.conversationLifecycle.appendEntry({
      ...shared,
      role: "user",
      text: step.text,
    });
    return { entryId: entry.id, lineage: true };
  }

  if (step.type === "assistant") {
    const entry = await services.conversationLifecycle.appendEntry({
      ...shared,
      role: "assistant",
      text: step.text,
      usage: {
        input: 18_400,
        output: 640,
        cacheRead: 12_800,
        cacheWrite: 2_100,
        totalTokens: 33_940,
        cost: 0.041,
      },
      details: step.thinking
        ? { thinkingBlocks: [{ type: "thinking", text: step.thinking }] }
        : undefined,
    });
    return { entryId: entry.id, lineage: true };
  }

  const entry = await services.conversationLifecycle.appendEntry({
    ...shared,
    role: step.type === "compaction" ? "system" : "assistant",
    kind: step.type,
    text: step.text,
    ...(step.type === "compaction" ? { summary: step.text } : {}),
  });
  return { entryId: entry.id, lineage: step.type !== "compaction" };
}

async function seedConversation(
  context: SeedContext,
  demo: DemoConversation,
): Promise<void> {
  const { services, projectId, workspace } = context;
  const conversation = await services.conversationLifecycle.createConversation({
    projectId,
    title: demo.title,
    mode: demo.mode,
    permissionLevel: demo.permissionLevel,
  });
  const agent = await services.agentLifecycle.createAgent({
    conversationId: conversation.id,
    projectId,
    projectDir: workspace,
    mode: demo.mode,
    permissionLevel: demo.permissionLevel,
    workspaceScope: { roots: [workspace] },
    model: DEMO_MODEL,
    thinkingLevel: "medium",
  });
  for (let index = 0; index < (demo.exploreChildren ?? 0); index += 1) {
    await services.agentLifecycle.createAgent({
      conversationId: conversation.id,
      projectId,
      projectDir: workspace,
      parentAgentId: agent.id,
      task: `Explore task ${index + 1}`,
      workspaceScope: { roots: [workspace] },
      model: DEMO_MODEL,
    });
  }

  const runId = createId("run");
  /* Per step index, the entry a branch may fork from (undefined for
   * transcript-only steps such as tool anchors). */
  const lineageEntryIds: (string | undefined)[] = [];
  let parentEntryId: string | null = null;
  let tokensBefore = 12_000;

  for (const [index, step] of demo.steps.entries()) {
    const appended = await appendStep(context, {
      conversationId: conversation.id,
      agentId: agent.id,
      runId,
      parentEntryId,
      step,
      createdAt: at(demo.ageHours, index * 45),
      tokensBefore,
    });
    if (appended.lineage) parentEntryId = appended.entryId;
    lineageEntryIds.push(appended.lineage ? appended.entryId : undefined);
    tokensBefore += 3_400;
  }

  /* Branches are appended from an earlier entry, exactly as navigating back
   * and continuing would produce. The main line stays the active branch. */
  for (const [branchIndex, branch] of (demo.branches ?? []).entries()) {
    /* Fork from the nearest mirrored entry at or before the requested step,
     * since transcript-only entries cannot parent a branch. */
    let anchor: string | undefined;
    for (let index = branch.fromStep; index >= 0 && !anchor; index -= 1) {
      anchor = lineageEntryIds[index];
    }
    if (!anchor) continue;
    let branchParent: string | null = anchor;
    for (const [stepIndex, step] of branch.steps.entries()) {
      const appended = await appendStep(context, {
        conversationId: conversation.id,
        agentId: agent.id,
        runId: createId("run"),
        parentEntryId: branchParent,
        step,
        createdAt: at(
          demo.ageHours,
          (branch.fromStep + 1) * 45 + branchIndex * 600 + stepIndex * 45,
        ),
        tokensBefore,
      });
      if (appended.lineage) branchParent = appended.entryId;
    }
  }

  const lastEntryId = parentEntryId ?? undefined;
  await services.conversationLifecycle.updateConversation({
    ...services.conversationLifecycle.getConversation(conversation.id),
    activeEntryId: lastEntryId,
    pinned: demo.pinned,
    completedAt: demo.completed ? at(demo.ageHours - 1) : undefined,
    createdAt: at(demo.ageHours),
    updatedAt: at(demo.ageHours, demo.steps.length * 45),
    lastUserMessageAt: at(demo.ageHours),
  });
}

/** Project-resident task definitions, so the Tasks panel is not empty. */
async function writeTaskDefinitions(workspace: string): Promise<void> {
  const now = new Date(SEED_NOW).toISOString();
  const definitions = [
    { label: "aurora-web dev", command: "pnpm dev", cwd: "aurora-web" },
    { label: "aurora-api tests", command: "pnpm test", cwd: "aurora-api" },
    {
      label: "staging smoke",
      command: "pnpm smoke --env staging",
      cwd: "aurora-infra",
    },
  ].map((definition) => ({
    id: createId("taskdef"),
    scope: { kind: "project" as const },
    label: definition.label,
    command: definition.command,
    cwd: definition.cwd,
    runPolicy: "single" as const,
    createdAt: now,
    updatedAt: now,
  }));
  const directory = join(workspace, ".nerve", "tasks");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "definitions.json"),
    `${JSON.stringify({ version: 1, definitions }, undefined, 2)}\n`,
    "utf8",
  );
}

async function seedTasks(
  context: SeedContext,
  storage: InitializedStorage,
): Promise<void> {
  const { services, projectId, workspace } = context;
  const repository = new TaskRepository(storage);
  const conversationId = services.conversationLifecycle
    .listConversations()
    .find((conversation) => conversation.projectId === projectId)?.id;

  const definitions = [
    {
      name: "aurora-web dev",
      command: "pnpm dev",
      cwd: `${workspace}/aurora-web`,
      status: "running" as const,
      logs: [
        "VITE v7.2.1  ready in 412 ms",
        "➜  Local:   http://127.0.0.1:5173/",
        "➜  press h + enter to show help",
        "12:04:19 [vite] page reload src/lib/VenueCard.svelte",
      ],
    },
    {
      name: "aurora-api tests",
      command: "pnpm test",
      cwd: `${workspace}/aurora-api`,
      status: "completed" as const,
      logs: [
        "✔ rate limit allows traffic under the window (4.1ms)",
        "✔ rate limit rejects past the burst allowance (2.8ms)",
        "# tests 42",
        "# pass 42",
        "# fail 0",
      ],
    },
    {
      name: "staging smoke",
      command: "pnpm smoke --env staging",
      cwd: `${workspace}/aurora-infra`,
      status: "completed" as const,
      logs: [
        "18 checks passed in 42s",
        "no rollbacks observed across 3 deploys",
      ],
    },
  ];

  for (const [index, definition] of definitions.entries()) {
    const id = createId("task");
    const paths = repository.bundles.paths(id);
    const record: TaskRecord = taskRecordSchema.parse({
      id,
      name: definition.name,
      displayName: definition.name,
      projectId,
      conversationId,
      cwd: definition.cwd,
      command: definition.command,
      status: definition.status,
      readiness:
        definition.status === "running"
          ? { outcome: "ready", detectedAt: at(1) }
          : { outcome: "none" },
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      combinedPath: paths.combinedPath,
      logsPath: paths.eventsPath,
      startedAt: at(2, index * 120),
      updatedAt: at(0.5),
      finishedAt: definition.status === "completed" ? at(0.5) : undefined,
      exitCode: definition.status === "completed" ? 0 : undefined,
      origin: { kind: "api" },
      visibility: "background",
    });
    await repository.write(record);
    const output = `${definition.logs.join("\n")}\n`;
    await writeFile(paths.stdoutPath, output, "utf8");
    await writeFile(paths.stderrPath, "", "utf8");
    await writeFile(paths.combinedPath, output, "utf8");
  }
}

async function main(): Promise<void> {
  const home = assertThrowaway(
    "NERVE_HOME",
    process.env.NERVE_HOME ?? "/tmp/nerve-demo-home",
  );
  const workspaceRoot = assertThrowaway(
    "NERVE_DEMO_WORKSPACE",
    process.env.NERVE_DEMO_WORKSPACE ?? "/tmp/nerve-demo-workspace",
  );

  console.log(`Seeding demo home  ${home}`);
  console.log(`Seeding workspace  ${workspaceRoot}`);

  await rm(home, { recursive: true, force: true });
  const workspaces = new Map<string, string>();
  for (const demoProject of DEMO_PROJECTS) {
    const workspace = await createDemoWorkspace(
      `${workspaceRoot}/${demoProject.id}`,
      demoProject,
    );
    workspaces.set(demoProject.id, workspace);
    console.log(
      `Created ${demoProject.repositories.length} repositories for ${demoProject.name} under ${workspace}`,
    );
  }

  const auroraWorkspace = workspaces.get("aurora");
  if (!auroraWorkspace)
    throw new Error("Aurora demo workspace was not created");
  if (process.env.NERVE_DEMO_GITHUB === "1") {
    await addPublicPullRequestRepo(auroraWorkspace);
    console.log("Cloned the public Nerve repository for the PR scene");
  }

  const storage = await initializeStorage(home);
  const fixture = composeServerRuntime(storage, "127.0.0.1", 0);
  await fixture.lifecycle.hydrate();

  try {
    /* A placeholder credential so the composer resolves a real model name
     * instead of prompting to select one. Nothing is ever sent: the seed only
     * writes records, and `setApiKey` performs no provider call. */
    await fixture.runtime.auth.setApiKey(
      DEMO_MODEL.provider,
      "sk-ant-demo-screenshot-fixture-key",
    );

    const toolCalls = new ToolCallRepository(
      fixture.services.conversationJournal,
    );
    /* Create Aurora last so narrow layouts, which intentionally hide the
     * title-bar project switcher, open on the project used by mobile scenes. */
    for (const demoProject of [...DEMO_PROJECTS].reverse()) {
      const workspace = workspaces.get(demoProject.id);
      if (!workspace) {
        throw new Error(`Missing demo workspace for ${demoProject.id}`);
      }
      const project = await fixture.services.projectLifecycle.createProject({
        dir: workspace,
        name: demoProject.name,
      });
      /* Project fallback selection sorts by millisecond timestamps. Keep the
       * intended mobile default deterministic even on a fast filesystem. */
      await new Promise((fulfil) => setTimeout(fulfil, 2));
      const context: SeedContext = {
        services: fixture.services,
        toolCalls,
        projectId: project.id,
        workspace,
      };

      const conversations = DEMO_PROJECT_CONVERSATIONS[demoProject.id];
      if (!conversations?.length) {
        throw new Error(`Missing demo conversations for ${demoProject.id}`);
      }
      for (const demo of conversations) {
        await seedConversation(context, demo);
        console.log(`Seeded ${demoProject.name} conversation  ${demo.title}`);
      }

      if (demoProject.id === "aurora") {
        await writeTaskDefinitions(workspace);
        await seedTasks(context, storage);
      }
    }

    console.log(`Demo home ready with ${DEMO_PROJECTS.length} projects.`);
  } finally {
    await shutdownServerRuntime(fixture.runtime);
  }
}

await main();

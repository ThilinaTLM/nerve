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
 * Data is written through the current core services and schema-valid event
 * repositories — no raw SQL and no provider calls.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createId } from "@nervekit/contracts";
import { z } from "zod";
import type { AssistantContent } from "@nervekit/contracts/core";
import {
  composeServerRuntime,
  shutdownServerRuntime,
} from "../src/app/runtime/server-runtime.js";
import { initializeStorage } from "../src/infrastructure/storage-bootstrap/index.js";
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
  readonly projectId: string;
  readonly workspace: string;
}

const usage = {
  input: 18400,
  output: 640,
  cacheRead: 12800,
  cacheWrite: 2100,
  totalTokens: 33940,
  cost: {
    input: 0.02,
    output: 0.01,
    cacheRead: 0.001,
    cacheWrite: 0.01,
    total: 0.041,
  },
};

/** Use the current schema-valid event repository, never legacy agent records or raw SQL. */
function appendStep(
  context: SeedContext,
  conversationId: string,
  step: DemoStep,
  previousEventId: string | null,
  createdAt: string,
): string {
  const { coreStorage } = context.services;
  const fields = {
    id: createId("evt"),
    conversationId,
    previousEventId,
    turnId: createId("turn"),
    inputId: null,
    createdAt,
  };
  const assistant = (content: AssistantContent[]) =>
    coreStorage.events.append({
      ...fields,
      type: "assistant_message",
      llmRepresentation: "assistant",
      payload: {
        content,
        usage,
        stopReason: "stop",
        api: "anthropic-messages",
        provider: DEMO_MODEL.provider,
        model: DEMO_MODEL.modelId,
      },
    });
  if (step.type === "user")
    return coreStorage.events.append({
      ...fields,
      type: "user_message",
      llmRepresentation: "user",
      payload: {
        text: step.text,
        originalText: step.text,
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    }).id;
  if (step.type === "tool") {
    const toolCallId = createId("tool");
    const args = z.record(z.string(), z.json()).parse(step.args);
    const anchor = assistant([
      {
        type: "toolCall",
        id: toolCallId,
        name: step.toolName,
        arguments: args,
      },
    ]);
    return coreStorage.events.append({
      ...fields,
      id: createId("evt"),
      previousEventId: anchor.id,
      type: "tool_call_response",
      llmRepresentation: "tool_result",
      payload: {
        toolCallId,
        providerCallId: toolCallId,
        toolName: step.toolName,
        arguments: args,
        origin: "model",
        assistantEventId: anchor.id,
        contentIndex: 0,
        outcome: "completed",
        agentProjection: [{ type: "text", text: JSON.stringify(step.result) }],
        userProjection: {
          argsPreview: args,
          resultPreview: z.json().parse(step.result),
        },
        supervision: null,
        interactionResolution: null,
        resolutionRequestId: null,
        assetIds: [],
      },
    }).id;
  }
  if (step.type === "compaction")
    return coreStorage.events.append({
      ...fields,
      type: "compaction",
      llmRepresentation: "user",
      payload: {
        summary: step.text,
        firstKeptEventId: previousEventId,
        tokensBefore: 48000,
        details: null,
      },
    }).id;
  return assistant([
    ...(step.type === "assistant" && step.thinking
      ? [{ type: "thinking" as const, thinking: step.thinking }]
      : []),
    { type: "text", text: step.text },
  ]).id;
}

async function seedConversation(
  context: SeedContext,
  demo: DemoConversation,
): Promise<void> {
  const { services, projectId, workspace } = context;
  const { conversationCore, coreStorage } = services;
  const { conversation } = await conversationCore.conversations.create({
    projectId,
    title: demo.title,
    config: {
      model: DEMO_MODEL,
      reasoningLevel: "medium",
      systemPrompt: null,
      instructions: null,
      mode: demo.mode,
      permissionRuleSetId: demo.permissionRuleSetId,
      workingDirectory: workspace,
    },
  });
  let head: string | null = null;
  const anchors: string[] = [];
  for (const [index, step] of demo.steps.entries()) {
    head = appendStep(
      context,
      conversation.id,
      step,
      head,
      at(demo.ageHours, index * 45),
    );
    anchors.push(head);
  }
  const mainHead = head;
  for (const [branchIndex, branch] of (demo.branches ?? []).entries()) {
    let parent = anchors[branch.fromStep] ?? null;
    for (const [index, step] of branch.steps.entries()) {
      parent = appendStep(
        context,
        conversation.id,
        step,
        parent,
        at(
          demo.ageHours,
          (branch.fromStep + 1) * 45 + branchIndex * 600 + index * 45,
        ),
      );
    }
  }
  // Retained child conversations are the current unified sub-agent model.
  for (const child of demo.children ?? []) {
    const args = {
      assignments: [
        { name: child.name, profile: child.profile, prompt: child.task },
      ],
    };
    head = appendStep(
      context,
      conversation.id,
      {
        type: "tool",
        toolName: "subagent_prompt",
        risk: "agent_spawn",
        args,
        result: {
          content: "Assignment completed.",
          details: { name: child.name, profile: child.profile },
        },
      },
      head,
      at(demo.ageHours, 650),
    );
    const response = coreStorage.events.get(head)!;
    if (response.type !== "tool_call_response")
      throw new Error("Missing sub-agent creation response");
    const parentToolCallId = response.payload.toolCallId;
    const created = await conversationCore.conversations.create({
      projectId,
      parentConversationId: conversation.id,
      parentToolCallId,
      title: child.name,
      config: {
        model: DEMO_MODEL,
        reasoningLevel: "medium",
        systemPrompt: null,
        instructions: null,
        mode: "coding",
        permissionRuleSetId: "read_only",
        workingDirectory: workspace,
      },
    });
    appendStep(
      context,
      created.conversation.id,
      { type: "assistant", text: child.report },
      null,
      at(demo.ageHours, 680),
    );
  }
  if (demo.children?.length) {
    head = appendStep(
      context,
      conversation.id,
      {
        type: "assistant",
        text: "Both profile-based reviews are complete. Open an agent in the activity island to inspect its conversation; the background verification command is retained under Commands.",
      },
      head,
      at(demo.ageHours, 700),
    );
  }
  if (demo.asyncCommand) {
    const bashId = createId("bash");
    const response = anchors
      .map((id) => coreStorage.events.get(id))
      .find(
        (event) =>
          event?.type === "tool_call_response" &&
          event.payload.toolName === "bash" &&
          event.payload.arguments.command === demo.asyncCommand,
      );
    if (response?.type !== "tool_call_response")
      throw new Error("Missing background bash tool response");
    const toolCallId = response.payload.toolCallId;
    coreStorage.asyncBash.insert({
      id: bashId,
      conversationId: conversation.id,
      toolCallId,
      command: demo.asyncCommand,
      workingDirectory: `${workspace}/aurora-api`,
      status: "completed",
      processRef: null,
      exitCode: 0,
      startedAt: at(demo.ageHours, 500),
      finishedAt: at(demo.ageHours, 540),
    });
    const output =
      "✔ rate limit allows traffic under the window\n✔ rate limit rejects past the burst allowance\n✔ booking creation remains available below the cap\n\n3 tests passed\n";
    for (const [stream, content] of Object.entries({
      stdout: output,
      stderr: "",
      output,
    })) {
      await conversationCore.assets.write({
        conversationId: conversation.id,
        toolCallId,
        asyncBashId: bashId,
        category: "bash_output",
        mediaType: "text/plain",
        logicalPath: `conversations/${conversation.id}/bash/${bashId}/${stream}.txt`,
        content,
      });
    }
  }
  coreStorage.conversations.update(conversation.id, {
    headEventId: head ?? mainHead,
    pinnedAt: demo.pinned ? at(demo.ageHours) : null,
    completedAt: demo.completed ? at(demo.ageHours - 1) : null,
    updatedAt: at(demo.ageHours, demo.steps.length * 45),
    lastUserMessageAt: at(demo.ageHours),
  });
}

/** Project-resident launch configurations, shared by the UI and launch tool. */
async function writeLaunchDefinitions(workspace: string): Promise<void> {
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
    id: createId("launchdef"),
    scope: { kind: "project" as const },
    label: definition.label,
    command: definition.command,
    cwd: definition.cwd,
    runPolicy: "single" as const,
    createdAt: now,
    updatedAt: now,
  }));
  const directory = join(workspace, ".nerve", "launches");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "definitions.json"),
    `${JSON.stringify({ version: 1, definitions }, undefined, 2)}\n`,
    "utf8",
  );
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

    /* Create Aurora last so narrow layouts, which intentionally hide the
     * title-bar project switcher, open on the project used by mobile scenes. */
    for (const demoProject of [...DEMO_PROJECTS].reverse()) {
      const workspace = workspaces.get(demoProject.id);
      if (!workspace) {
        throw new Error(`Missing demo workspace for ${demoProject.id}`);
      }
      const project = await fixture.services.conversationCore.projects.create({
        directory: workspace,
        name: demoProject.name,
      });
      /* Project fallback selection sorts by millisecond timestamps. Keep the
       * intended mobile default deterministic even on a fast filesystem. */
      await new Promise((fulfil) => setTimeout(fulfil, 2));
      const context: SeedContext = {
        services: fixture.services,
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
        await writeLaunchDefinitions(workspace);
      }
    }

    console.log(`Demo home ready with ${DEMO_PROJECTS.length} projects.`);
  } finally {
    await shutdownServerRuntime(fixture.runtime);
  }
}

await main();

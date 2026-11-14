/** Conversation driving: project, create, submit, poll with approvals, events, run contexts. */
import { mkdir } from "node:fs/promises";
import type { Loose } from "./loose.ts";
import { join } from "node:path";
import { createId, type DaemonClient } from "./daemon-client.ts";
import {
  sleep,
  overridesFor,
  type Environment,
  type ModelRef,
} from "./config.ts";
import type { BenchEvent } from "./metrics.ts";
import type { TaskContext, Variant } from "./types.ts";

export async function ensureProject(
  client: DaemonClient,
  name: string,
  directory: string,
  create: boolean,
): Promise<{ id: string; directory: string } | undefined> {
  const projects = await client.call<
    { id: string; name: string; directory: string }[]
  >("project.list", {});
  const existing = projects.find((project) => project.name === name);
  if (existing) return existing;
  if (!create) return undefined;
  await mkdir(directory, { recursive: true });
  const created = await client.call<{ id: string; directory: string }>(
    "project.create",
    { id: createId("proj"), name, directory },
  );
  return created;
}

export interface DriveResult {
  state: "done" | "failed" | "timeout";
  approved: number;
  denied: number;
  questions: number;
  note?: string;
}

/** Poll one conversation to completion, answering approvals by policy. */
export async function drive(
  env: Environment,
  conversationId: string,
  baselineSequence: number,
  deadline: number,
  decide: (call: {
    toolName: string;
    arguments: unknown;
    request?: unknown;
  }) => "approve" | "deny",
): Promise<DriveResult> {
  const { client } = env;
  const result: DriveResult = {
    state: "done",
    approved: 0,
    denied: 0,
    questions: 0,
  };
  const handled = new Set<string>();
  let stableSince: number | undefined;
  let lastSequence = -1;
  while (Date.now() < deadline) {
    const snapshot = await client.call<Loose>("conversation.getSnapshot", {
      conversationId,
    });
    for (const call of snapshot.toolCalls as Loose[]) {
      const interaction = call.interaction;
      if (!interaction || interaction.resolution || handled.has(call.id))
        continue;
      handled.add(call.id);
      const resolve = (resolution: unknown) =>
        client.call("interaction.resolve", {
          toolCallId: call.id,
          resolutionRequestId: createId("req"),
          resolution,
        });
      if (interaction.kind === "approval") {
        const decision = decide({
          toolName: call.toolName,
          arguments: call.arguments,
          request: interaction.request,
        });
        await resolve({ kind: "approval", decision });
        if (decision === "approve") result.approved += 1;
        else result.denied += 1;
      } else if (interaction.kind === "user_input") {
        await resolve({ kind: "user_input", answers: {}, dismissed: true });
        result.questions += 1;
      } else if (interaction.kind === "configuration_blocked") {
        await resolve({ kind: "configuration_blocked", decision: "cancel" });
        return {
          ...result,
          state: "failed",
          note: "configuration blocked the run (cancelled)",
        };
      } else {
        return {
          ...result,
          state: "failed",
          note: `unsupported interaction ${interaction.kind}`,
        };
      }
    }
    const quiet =
      snapshot.lastSequence > baselineSequence &&
      snapshot.conversation.status !== "running" &&
      snapshot.conversation.status !== "waiting" &&
      snapshot.queue.length === 0 &&
      snapshot.toolCalls.length === 0;
    if (quiet && snapshot.conversation.status !== "idle")
      return {
        ...result,
        state: "failed",
        note: `conversation ended ${snapshot.conversation.status}`,
      };
    if (quiet && snapshot.lastSequence === lastSequence) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 2_500) return result;
    } else stableSince = undefined;
    lastSequence = snapshot.lastSequence;
    await sleep(1_000);
  }
  await client
    .call("conversation.stop", { conversationId })
    .catch(() => undefined);
  return { ...result, state: "timeout", note: "timed out" };
}

export async function createConversation(
  env: Environment,
  title: string,
  workingDirectory: string,
  model: ModelRef,
  variant: Variant | "none",
): Promise<string> {
  const id = createId("conv");
  await env.client.call("conversation.create", {
    id,
    projectId: env.projectId,
    title,
    config: { workingDirectory },
    overrides: overridesFor(env.flags, model, variant),
  });
  return id;
}

export async function submit(
  env: Environment,
  conversationId: string,
  text: string,
): Promise<number> {
  const before = await env.client.call<Loose>("conversation.getSnapshot", {
    conversationId,
  });
  await env.client.call("input.submit", {
    conversationId,
    inputId: createId("input"),
    text,
    source: "user",
  });
  return before.lastSequence;
}

export async function loadEvents(
  env: Environment,
  conversationId: string,
): Promise<BenchEvent[]> {
  return env.client.call<BenchEvent[]>("conversation.getEventsSince", {
    conversationId,
    sequence: 0,
  });
}

export async function runCleanups(
  cleanups: { label: string; undo: () => Promise<void> }[],
): Promise<string[]> {
  const problems: string[] = [];
  for (const { label, undo } of cleanups.reverse())
    await undo().catch((error: unknown) =>
      problems.push(`cleanup "${label}" failed: ${(error as Error).message}`),
    );
  return problems;
}

export function newContext(
  env: Environment,
  taskId: string,
): {
  ctx: TaskContext;
  cleanups: { label: string; undo: () => Promise<void> }[];
} {
  const runId = Math.random().toString(36).slice(2, 7);
  const cleanups: { label: string; undo: () => Promise<void> }[] = [];
  const ctx: TaskContext = {
    atlassian: env.atlassian!,
    sandbox: env.sandbox,
    runId,
    tag: `bench-${runId}`,
    workspaceDir: join(env.projectDir, `${taskId}-${runId}`),
    data: {},
    onCleanup: (label, undo) => cleanups.push({ label, undo }),
  };
  return { ctx, cleanups };
}

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  conversationEntrySchema,
  conversationRecordSchema,
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
  toolCallRecordSchema,
  type ConversationJournalEvent,
  type RunEventDeliveryRecord,
  type RunTransitionRecord,
} from "@nervekit/contracts";
import { ConversationJournalRepository } from "../../../domains/conversations/conversation-journal.repository.js";
import { externalizeToolCallResult } from "../../../domains/tools/tool-result-artifact.js";
import { atomicWriteJson, pathExists } from "../../storage/json.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";
import { reduceRunTransitions } from "../../../domains/runs/runtime/index.js";

const markerPath = "migrations/.conversation-aggregate-journals-v1";

export const migration0015: StorageMigration = {
  id: "0015-conversation-aggregate-journals",
  description: "Unify conversation, tool, model-context, and run journals",
  checksum: migrationChecksum(
    "0015-conversation-aggregate-journals|v1|Unify conversation, tool, model-context, and run journals",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup() {
    return {
      paths: ["conversations", "agents", "run-runtime", markerPath],
    };
  },
  async up(context) {
    const home = context.paths.home;
    const journal = new ConversationJournalRepository({ paths: { home } });
    const conversations = await childDirectories(join(home, "conversations"));
    let transitionCount = 0;

    for (const conversationId of conversations) {
      const directory = join(home, "conversations", conversationId);
      const journalExists = await pathExists(join(directory, "journal.jsonl"));
      const conversationExists = await pathExists(
        join(directory, "conversation.json"),
      );
      if (journalExists) {
        if (conversationExists || (await hasLegacyAuthority(directory))) {
          throw new Error(
            `Conversation '${conversationId}' has a mixed journal and legacy layout.`,
          );
        }
        continue;
      }
      if (!conversationExists) {
        // A directory without canonical conversation metadata cannot be
        // projected into an aggregate. Its orphaned sidecars are retained in
        // the rollback bundle, then removed from the live layout.
        await rm(directory, { recursive: true, force: true });
        continue;
      }
      const conversation = conversationRecordSchema.parse(
        JSON.parse(
          await readFile(join(directory, "conversation.json"), "utf8"),
        ),
      );
      const events: ConversationJournalEvent[] = [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation,
        },
      ];
      for (const entry of await jsonLines(join(directory, "entries.jsonl"))) {
        const parsed = conversationEntrySchema.safeParse(entry);
        if (parsed.success) {
          events.push({
            kind: "conversation.entry_appended",
            conversationId,
            entry: parsed.data,
          });
        }
      }
      const harness = await jsonLines(join(directory, "harness.jsonl"));
      for (const entry of harness) {
        if (!isRecord(entry) || entry.type === "conversation") continue;
        events.push({
          kind: "model_context.entry_appended",
          conversationId,
          entry: entry as never,
        });
      }
      for (const toolCall of await legacyToolCalls(home, directory)) {
        events.push({
          kind: "tool_call.upserted",
          conversationId,
          toolCall,
        });
      }
      for (let offset = 0; offset < events.length; offset += 256) {
        await journal.commit(conversationId, {
          kind:
            offset === 0 ? "migration.bootstrap" : "migration.bootstrap_chunk",
          events: events.slice(offset, offset + 256),
          committedAt: conversation.updatedAt,
        });
      }

      await Promise.all([
        rm(join(directory, "conversation.json"), { force: true }),
        rm(join(directory, "entries.jsonl"), { force: true }),
        rm(join(directory, "harness.jsonl"), { force: true }),
        rm(join(directory, "tool-calls"), { recursive: true, force: true }),
      ]);
      journal.unload(conversationId);
    }

    for (const runId of await childDirectories(
      join(home, "run-runtime", "runs"),
    )) {
      const transitions = await legacyRunTransitionsForRun(home, runId);
      const conversationId = transitions[0]?.run.conversationId;
      if (!conversationId) continue;
      const aggregate = await journal.load(conversationId);
      if (!aggregate.conversation) continue;
      transitions.sort(compareRunTransitions);
      const deliveries = (await legacyRunDeliveriesForRun(home, runId)).sort(
        (left, right) => left.deliveredAt.localeCompare(right.deliveredAt),
      );
      const runEvents: ConversationJournalEvent[] = [
        ...transitions.map((transition) => ({
          kind: "run.transition_committed" as const,
          conversationId,
          transition,
        })),
        ...deliveries.map((delivery) => ({
          kind: "run.event_delivered" as const,
          conversationId,
          delivery,
        })),
      ];
      for (let offset = 0; offset < runEvents.length; offset += 256) {
        await journal.commit(conversationId, {
          kind: "migration.run_journal",
          committedAt:
            transitions.at(-1)?.committedAt ??
            deliveries.at(-1)?.deliveredAt ??
            context.now().toISOString(),
          events: runEvents.slice(offset, offset + 256),
        });
      }
      transitionCount += transitions.length;
      await normalizeLegacyInteractions(journal, conversationId, transitions);
      journal.unload(conversationId);
    }

    for (const conversationId of conversations) {
      const state = await journal.load(conversationId);
      if (state.conversation) {
        await cancelLegacyOrphanInteractions(
          journal,
          conversationId,
          context.now().toISOString(),
        );
      }
      journal.unload(conversationId);
    }

    for (const agentId of await childDirectories(join(home, "agents"))) {
      const childPath = join(home, "agents", agentId, "conversation.jsonl");
      if (!(await pathExists(childPath))) continue;
      const lines = await jsonLines(childPath);
      const header = lines[0];
      if (
        !isRecord(header) ||
        header.type !== "conversation" ||
        typeof header.id !== "string" ||
        !header.id.startsWith("conv_")
      ) {
        throw new Error(
          `Agent '${agentId}' has an invalid conversation header.`,
        );
      }
      const conversationId = header.id;
      const entries = lines.slice(1);
      for (let offset = 0; offset < entries.length; offset += 256) {
        await journal.commit(conversationId, {
          kind: "migration.agent_model_context",
          events: entries.slice(offset, offset + 256).map((entry) => ({
            kind: "model_context.entry_appended" as const,
            conversationId,
            ownerAgentId: agentId,
            entry: entry as never,
          })),
        });
      }
      await rm(childPath, { force: true });
      journal.unload(conversationId);
    }

    await rm(join(home, "run-runtime"), { recursive: true, force: true });
    await atomicWriteJson(
      join(home, markerPath),
      {
        migratedAt: context.now().toISOString(),
        conversations: conversations.length,
        transitions: transitionCount,
      },
      0o600,
    );
  },
  async verify(context) {
    const home = context.paths.home;
    if (!(await pathExists(join(home, markerPath)))) {
      throw new Error("Conversation aggregate journal marker is missing.");
    }
    if (await pathExists(join(home, "run-runtime"))) {
      throw new Error("Legacy run-runtime storage remains after migration.");
    }
    for (const agentId of await childDirectories(join(home, "agents"))) {
      if (
        await pathExists(join(home, "agents", agentId, "conversation.jsonl"))
      ) {
        throw new Error(
          `Legacy agent conversation authority remains for '${agentId}'.`,
        );
      }
    }
    const journal = new ConversationJournalRepository({ paths: { home } });
    for (const conversationId of await childDirectories(
      join(home, "conversations"),
    )) {
      const directory = join(home, "conversations", conversationId);
      if (!(await pathExists(join(directory, "journal.jsonl")))) {
        throw new Error(`Conversation '${conversationId}' has no journal.`);
      }
      for (const legacy of [
        "conversation.json",
        "entries.jsonl",
        "harness.jsonl",
        "tool-calls",
      ]) {
        if (await pathExists(join(directory, legacy))) {
          throw new Error(
            `Legacy conversation authority remains at '${conversationId}/${legacy}'.`,
          );
        }
      }
      await journal.load(conversationId);
      journal.unload(conversationId);
    }
  },
};

async function normalizeLegacyInteractions(
  journal: ConversationJournalRepository,
  conversationId: string,
  transitions: RunTransitionRecord[],
): Promise<void> {
  for (const runId of new Set(
    transitions.map((transition) => transition.runId),
  )) {
    const runTransitions = transitions
      .filter((transition) => transition.runId === runId)
      .sort((left, right) => left.revision - right.revision);
    const runState = reduceRunTransitions(runTransitions);
    if (!runState || runState.run.status !== "waiting") continue;
    const journalState = await journal.load(conversationId);
    const pending = runState.interactions.filter(
      (interaction) => interaction.status === "pending",
    );
    const valid = pending.filter((interaction) => {
      const toolCall = journalState.toolCalls.get(interaction.toolCallId);
      return Boolean(
        toolCall &&
        toolCall.revision === interaction.toolCallRevision &&
        toolCall.interactions[interaction.interactionOrdinal]?.status ===
          "pending",
      );
    });
    if (valid.length === 0) continue;
    const events: ConversationJournalEvent[] = valid.map((interaction) => {
      const toolCall = journalState.toolCalls.get(interaction.toolCallId)!;
      return {
        kind: "interaction.upserted",
        conversationId,
        interaction: {
          id: interaction.id,
          conversationId,
          runId,
          executionId: runState.run.executionId,
          suspensionId: legacySuspensionId(interaction.checkpointId),
          checkpointId: interaction.checkpointId,
          toolCallId: toolCall.id,
          toolCallRevision: toolCall.revision,
          interaction: toolCall.interactions[interaction.interactionOrdinal]!,
        },
      };
    });
    for (const checkpointId of new Set(
      valid.map((interaction) => interaction.checkpointId),
    )) {
      const members = valid.filter(
        (interaction) => interaction.checkpointId === checkpointId,
      );
      const orderedIds =
        members[0]?.batchToolCallIds ??
        members.map((interaction) => interaction.toolCallId);
      const ordered = orderedIds.flatMap((toolCallId) => {
        const interaction = members.find(
          (candidate) => candidate.toolCallId === toolCallId,
        );
        return interaction ? [interaction] : [];
      });
      events.push({
        kind: "suspension.upserted",
        conversationId,
        suspension: {
          id: legacySuspensionId(checkpointId),
          conversationId,
          runId,
          executionId: runState.run.executionId,
          checkpointId,
          status: "open",
          members: ordered.map((interaction, ordinal) => ({
            ordinal,
            interactionId: interaction.id,
            toolCallId: interaction.toolCallId,
            toolCallRevision: interaction.toolCallRevision,
            kind: interaction.kind,
          })),
          createdAt: ordered[0]!.createdAt,
          updatedAt: runState.run.updatedAt,
        },
      });
    }
    await journal.commit(conversationId, {
      kind: "migration.normalized_interactions",
      committedAt: runState.run.updatedAt,
      events,
    });
  }
}

async function cancelLegacyOrphanInteractions(
  journal: ConversationJournalRepository,
  conversationId: string,
  now: string,
): Promise<void> {
  const state = await journal.load(conversationId);
  const actionableToolCallIds = new Set(
    [...state.suspensions.values()]
      .filter((suspension) => suspension.status === "open")
      .flatMap((suspension) =>
        suspension.members.map((member) => member.toolCallId),
      ),
  );
  const events: ConversationJournalEvent[] = [];
  for (const toolCall of state.toolCalls.values()) {
    if (
      toolCall.status !== "waiting" ||
      actionableToolCallIds.has(toolCall.id) ||
      !toolCall.interactions.some(
        (interaction) => interaction.status === "pending",
      )
    )
      continue;
    events.push({
      kind: "tool_call.upserted",
      conversationId,
      toolCall: {
        ...toolCall,
        revision: toolCall.revision + 1,
        status: "failed",
        error: "Pending interaction was cancelled during storage migration.",
        updatedAt: now,
        settledAt: now,
        interactions: toolCall.interactions.map((interaction) =>
          interaction.status === "pending"
            ? {
                ...interaction,
                status: "cancelled" as const,
                updatedAt: now,
                cancelledAt: now,
              }
            : interaction,
        ),
      },
    });
  }
  for (let offset = 0; offset < events.length; offset += 256) {
    await journal.commit(conversationId, {
      kind: "migration.cancelled_orphan_interactions",
      committedAt: now,
      events: events.slice(offset, offset + 256),
    });
  }
}

function legacySuspensionId(checkpointId: string): string {
  return `suspension_${checkpointId.slice("checkpoint_".length)}`;
}

async function hasLegacyAuthority(directory: string): Promise<boolean> {
  for (const name of [
    "conversation.json",
    "entries.jsonl",
    "harness.jsonl",
    "tool-calls",
  ]) {
    if (await pathExists(join(directory, name))) return true;
  }
  return false;
}

async function legacyToolCalls(home: string, directory: string) {
  const calls = [];
  for (const file of await readdir(join(directory, "tool-calls"), {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    calls.push(
      await externalizeToolCallResult(
        home,
        toolCallRecordSchema.parse(
          JSON.parse(
            await readFile(join(directory, "tool-calls", file.name), "utf8"),
          ),
        ),
      ),
    );
  }
  return calls.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

async function legacyRunTransitionsForRun(
  home: string,
  runId: string,
): Promise<RunTransitionRecord[]> {
  return (
    await jsonLines(
      join(home, "run-runtime", "runs", runId, "transitions.jsonl"),
    )
  ).map((value) => runTransitionRecordSchema.parse(value));
}

async function legacyRunDeliveriesForRun(
  home: string,
  runId: string,
): Promise<RunEventDeliveryRecord[]> {
  return (
    await jsonLines(
      join(home, "run-runtime", "runs", runId, "event-deliveries.jsonl"),
    )
  ).map((value) => runEventDeliveryRecordSchema.parse(value));
}

async function childDirectories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function jsonLines(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

function compareRunTransitions(
  left: RunTransitionRecord,
  right: RunTransitionRecord,
): number {
  if (left.runId === right.runId) return left.revision - right.revision;
  return (
    left.committedAt.localeCompare(right.committedAt) ||
    left.runId.localeCompare(right.runId) ||
    left.revision - right.revision
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

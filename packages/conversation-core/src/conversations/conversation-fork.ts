import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createId } from "@nervekit/contracts";
import type {
  Asset,
  Conversation,
  ConversationEvent,
  ConversationSnapshot,
} from "@nervekit/contracts/core";
import { conversationEventSchema } from "@nervekit/contracts/core";
import type { AgentConfigurationPort } from "../configuration.js";
import type { CoreEmitter } from "../runtime/core-change.js";
import { publishSummary } from "../runtime/publish-summary.js";
import type { CoreStorage } from "../storage/core-storage.js";

const COPY_CONCURRENCY = 16;
const CHILD_REPORT =
  /conversations\/([A-Za-z0-9_-]+)\/reports\/([A-Za-z0-9_-]+\.md)/g;

const FORK_PREFIX = /^F(\d+): /;

/**
 * `Title` → `F1: Title`: the smallest free fork number among the project's
 * titles. Forking a fork numbers from the same base, so `F1: Title` → `F2: Title`.
 */
export function forkTitle(title: string, existing: Iterable<string>): string {
  const base = title.replace(FORK_PREFIX, "");
  const taken = new Set<number>();
  for (const other of existing) {
    const match = FORK_PREFIX.exec(other);
    if (match && other.slice(match[0].length) === base)
      taken.add(Number(match[1]));
  }
  let next = 1;
  while (taken.has(next)) next++;
  return `F${next}: ${base}`;
}

function noticeText(sourceId: string, agents: string[]): string {
  const forked = `Forked from conversation ${sourceId}.`;
  if (!agents.length) return forked;
  return `${forked} Sub-agents from before this point (${agents.join(", ")}) are not available in this conversation. Using one of those names starts a new agent without its earlier context.`;
}

/** Runs `work` over `items` with bounded parallelism; stops at the first failure. */
async function each<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) await work(items[index++]!);
  };
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, worker),
  );
}

export class ConversationForker {
  constructor(
    private readonly options: {
      storage: CoreStorage;
      dataDir: string;
      configuration: Pick<
        AgentConfigurationPort,
        "copyConversationConfiguration" | "summary"
      >;
      emit: CoreEmitter;
      now(): string;
      assertQuiescent(id: string): void;
      snapshot(id: string): ConversationSnapshot;
    },
  ) {}

  async fork(sourceId: string, eventId: string): Promise<ConversationSnapshot> {
    const { storage } = this.options;
    this.options.assertQuiescent(sourceId);
    const source = storage.conversations.get(sourceId);
    const context = storage.conversations.getContext(sourceId);
    if (!source || !context) throw new Error("Conversation not found");
    if (source.parentConversationId)
      throw new Error("Sub-agent conversations cannot be forked");
    if (storage.events.get(eventId)?.conversationId !== sourceId)
      throw new Error("Fork event belongs to another conversation");
    const path = storage.events.pathTo(sourceId, eventId);

    const forkId = createId("conv");
    const eventIds = new Map<string, string>();
    for (const event of path) eventIds.set(event.id, createId("evt"));
    const copiedAssets = storage.assets
      .list(sourceId)
      .filter((asset) => asset.eventId !== null && eventIds.has(asset.eventId));
    const ids = new Map(eventIds);
    const assetIds = new Map<string, string>();
    for (const asset of copiedAssets) {
      const id = createId("asset");
      assetIds.set(asset.id, id);
      ids.set(asset.id, id);
    }

    const sourcePrefix = `conversations/${sourceId}/`;
    const forkPrefix = `conversations/${forkId}/`;
    const reports = new Set<string>();
    const rewrite = (value: unknown): unknown => {
      if (typeof value === "string") {
        const mapped = ids.get(value);
        if (mapped !== undefined) return mapped;
        if (!value.includes("conversations/")) return value;
        return value
          .replace(CHILD_REPORT, (match, child: string, file: string) => {
            // The source's own reports are covered by the prefix rewrite below.
            if (child === sourceId) return match;
            reports.add(`${child}/${file}`);
            return `conversations/${forkId}/reports/${file}`;
          })
          .replaceAll(sourcePrefix, forkPrefix);
      }
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
        );
      return value;
    };
    const events: ConversationEvent[] = path.map((event, index) =>
      conversationEventSchema.parse({
        ...event,
        id: eventIds.get(event.id),
        conversationId: forkId,
        sequence: index + 1,
        previousEventId: event.previousEventId
          ? eventIds.get(event.previousEventId)
          : null,
        inputId: null,
        payload: rewrite(event.payload),
      }),
    );
    const assets: Asset[] = copiedAssets.map((asset) => ({
      ...asset,
      id: assetIds.get(asset.id)!,
      conversationId: forkId,
      eventId: eventIds.get(asset.eventId!)!,
      asyncBashId: null,
      logicalPath: asset.logicalPath.startsWith(sourcePrefix)
        ? forkPrefix + asset.logicalPath.slice(sourcePrefix.length)
        : asset.logicalPath,
    }));

    // Sub-agents the model addressed before the fork point.
    const delegated = new Set(
      path.flatMap((event) =>
        event.type === "tool_call_response" &&
        event.payload.toolName === "subagent_prompt"
          ? [event.payload.toolCallId]
          : [],
      ),
    );
    const agents = [
      ...new Set(
        storage.conversations
          .list({ projectId: source.projectId, parentConversationId: sourceId })
          .filter(
            (child) =>
              child.parentToolCallId && delegated.has(child.parentToolCallId),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((child) => child.title),
      ),
    ];

    const directory = join(this.options.dataDir, "conversations", forkId);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await this.copyFiles(sourceId, forkId, path, assets, [...reports]);
      await this.options.configuration.copyConversationConfiguration(
        sourceId,
        forkId,
      );
      // Everything below is synchronous: the title number and the rows land in
      // one step, with no await between them.
      const now = this.options.now();
      const last = events.at(-1);
      const notice = conversationEventSchema.parse({
        id: createId("evt"),
        conversationId: forkId,
        sequence: events.length + 1,
        previousEventId: last?.id ?? null,
        type: "system_event",
        llmRepresentation: "user",
        turnId: null,
        inputId: null,
        createdAt: now,
        payload: {
          subtype: "fork",
          sourceConversationId: sourceId,
          sourceTitle: source.title,
          subagents: agents,
          text: noticeText(sourceId, agents),
        },
      });
      const conversation: Conversation = {
        id: forkId,
        projectId: source.projectId,
        parentConversationId: null,
        parentToolCallId: null,
        headEventId: notice.id,
        title: forkTitle(
          source.title,
          storage.conversations.titles(source.projectId),
        ),
        status: "idle",
        statusEventSequence: notice.sequence,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        // No message has been sent in the fork yet; recency falls back to
        // creation, so the fork lists above its source.
        lastUserMessageAt: null,
        createdAt: now,
        updatedAt: now,
      };
      storage.insertFork({
        sourceId,
        conversation,
        workingDirectory: context.workingDirectory,
        events: [...events, notice],
        assets,
        eventIds,
      });
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    publishSummary(storage, this.options.emit, forkId);
    const snapshot = this.options.snapshot(forkId);
    this.options.emit({
      kind: "config_changed",
      conversationId: forkId,
      config: {
        ...snapshot.config,
        ...this.options.configuration.summary?.(forkId),
      },
    });
    return snapshot;
  }

  /** Copies conversation-scoped files with the same relative paths. */
  private async copyFiles(
    sourceId: string,
    forkId: string,
    path: readonly ConversationEvent[],
    assets: readonly Asset[],
    reports: readonly string[],
  ): Promise<void> {
    const root = join(this.options.dataDir, "conversations");
    const from = join(root, sourceId);
    const to = join(root, forkId);
    const entries = new Set<string>(["reports", "code-mode"]);
    for (const event of path)
      if (event.type === "tool_call_response")
        entries.add(`tool-calls/${event.payload.toolCallId}`);
    const forkPrefix = `conversations/${forkId}/`;
    for (const asset of assets) {
      if (!asset.logicalPath.startsWith(forkPrefix)) continue;
      const parts = asset.logicalPath.slice(forkPrefix.length).split("/");
      if (parts.some((part) => !part || part === "." || part === ".."))
        continue;
      // Owner directories (tool-calls/{id}, legacy async-bash/{id}) are copied whole.
      entries.add(parts.slice(0, Math.min(parts.length, 2)).join("/"));
    }
    const copy = async (source: string, target: string) => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      try {
        await cp(source, target, { recursive: true, force: false });
      } catch (error) {
        // Missing sources are tolerated: not every tool call has files.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    };
    // Sub-agent reports go last: they target the directory copied with `reports`.
    await each([...entries], (entry) =>
      copy(join(from, entry), join(to, entry)),
    );
    await each(reports, (report) => {
      const [child, file] = report.split("/") as [string, string];
      return copy(
        join(root, child, "reports", file),
        join(to, "reports", file),
      );
    });
  }
}

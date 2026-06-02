import {
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  type SessionTreeEntry,
} from "@nerve/agent";
import type {
  CompactSessionRequest,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
} from "@nerve/shared";
import type { EventBus } from "../events.js";
import type { HarnessManager } from "../harness-manager.js";
import { HttpError } from "../http/errors.js";
import type { InitializedStorage } from "../storage.js";
import { buildExtractiveSummary } from "./summary.js";

export interface AppendSessionEntryInput {
  id?: string;
  sessionId: string;
  agentId?: string;
  parentEntryId?: string | null;
  role: SessionEntry["role"];
  kind?: SessionEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
}

export type AppendSessionEntry = (
  input: AppendSessionEntryInput,
  options?: { mirrorToHarness?: boolean },
) => Promise<SessionEntry>;

export class CompactionService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly appendEntry: AppendSessionEntry,
    private readonly harnessManager: HarnessManager,
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: EventBus,
  ) {}

  async compactSession(
    sessionId: string,
    request: CompactSessionRequest = {},
  ): Promise<{ session: SessionRecord; entry: SessionEntry }> {
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const storage = await this.harnessManager.openStorage(session, project.dir);
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const settings = {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens:
        request.keepRecentTokens ??
        this.storage.settings.compaction.keepRecentTokens,
    };
    const prepared = prepareCompaction(branch, settings);
    if (!prepared.ok) {
      throw new HttpError(400, "COMPACTION_FAILED", prepared.error.message);
    }
    if (!prepared.value) {
      throw new HttpError(409, "NOTHING_TO_COMPACT", "Nothing to compact.");
    }
    const preparation = prepared.value;
    let firstKeptEntryId = preparation.firstKeptEntryId;
    let messagesToSummarize = [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ];
    if (messagesToSummarize.length === 0) {
      const messageEntries = branch.filter(
        (entry): entry is Extract<SessionTreeEntry, { type: "message" }> =>
          entry.type === "message",
      );
      const fallbackKept = messageEntries.at(-1);
      messagesToSummarize = messageEntries
        .slice(0, -1)
        .map((entry) => entry.message);
      if (fallbackKept) firstKeptEntryId = fallbackKept.id;
    }
    if (messagesToSummarize.length === 0) {
      throw new HttpError(
        409,
        "NOTHING_TO_COMPACT",
        "No prior messages to compact.",
      );
    }
    const summary = buildExtractiveSummary({
      title: "Context checkpoint",
      messages: messagesToSummarize,
      previousSummary: preparation.previousSummary,
      instructions: request.instructions,
    });
    const details = {
      generatedBy: "orchestrator-extractive",
      compactedMessages: messagesToSummarize.length,
      splitTurn: preparation.isSplitTurn,
      fileOps: {
        read: [...preparation.fileOps.read].sort(),
        written: [...preparation.fileOps.written].sort(),
        edited: [...preparation.fileOps.edited].sort(),
      },
    };
    const entry = await this.appendEntry(
      {
        sessionId,
        role: "system",
        kind: "compaction",
        text: summary,
        summary,
        tokensBefore: preparation.tokensBefore,
        firstKeptEntryId,
        details,
      },
      { mirrorToHarness: false },
    );
    await storage.appendEntry({
      type: "compaction",
      id: entry.id,
      parentId: entry.parentEntryId ?? null,
      timestamp: entry.createdAt,
      summary,
      firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details,
    });
    await this.rebuildConversations();
    await this.events.publish("session.compacted", {
      sessionId,
      entry,
      tokensBefore: preparation.tokensBefore,
      firstKeptEntryId,
    });
    return { session: this.getSession(sessionId), entry };
  }
}

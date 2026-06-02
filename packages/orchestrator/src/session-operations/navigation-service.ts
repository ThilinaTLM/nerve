import type { SessionTreeEntry } from "@nerve/agent";
import type {
  NavigateSessionRequest,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
} from "@nerve/shared";
import type { EventBus } from "../events.js";
import type { HarnessManager } from "../harness-manager.js";
import { HttpError } from "../http/errors.js";
import type { AppendSessionEntry } from "./compaction-service.js";
import { buildExtractiveSummary } from "./summary.js";

export class NavigationService {
  constructor(
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly entriesBySessionId: Map<string, SessionEntry[]>,
    private readonly updateSession: (session: SessionRecord) => Promise<void>,
    private readonly appendEntry: AppendSessionEntry,
    private readonly harnessManager: HarnessManager,
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: EventBus,
  ) {}

  async navigateSession(
    sessionId: string,
    request: NavigateSessionRequest,
  ): Promise<SessionRecord> {
    const session = this.getSession(sessionId);
    const activeEntryId = request.activeEntryId ?? undefined;
    if (
      activeEntryId &&
      !(this.entriesBySessionId.get(session.id) ?? []).some(
        (entry) => entry.id === activeEntryId,
      )
    ) {
      throw new HttpError(404, "ENTRY_NOT_FOUND", "Entry not found.");
    }

    let summaryEntry: SessionEntry | undefined;
    if (request.summarize && session.activeEntryId !== activeEntryId) {
      summaryEntry = await this.createBranchSummaryEntry(
        session,
        activeEntryId,
        request.summaryInstructions,
      );
    }

    const nextActiveEntryId = summaryEntry?.id ?? activeEntryId;
    const updated = {
      ...this.getSession(sessionId),
      activeEntryId: nextActiveEntryId,
      updatedAt: new Date().toISOString(),
    };
    await this.updateSession(updated);
    await this.harnessManager.setLeaf(updated, nextActiveEntryId);
    await this.rebuildConversations();
    await this.events.publish("session.navigated", {
      sessionId: session.id,
      activeEntryId: nextActiveEntryId,
      targetEntryId: activeEntryId,
      summaryEntry,
    });
    return updated;
  }

  async createBranchSummaryEntry(
    session: SessionRecord,
    targetEntryId: string | undefined,
    instructions?: string,
  ): Promise<SessionEntry | undefined> {
    const project = this.getProject(session.projectId);
    const storage = await this.harnessManager.openStorage(session, project.dir);
    const oldLeafId = await storage.getLeafId();
    if (oldLeafId === (targetEntryId ?? null)) return undefined;

    const oldBranch = oldLeafId ? await storage.getPathToRoot(oldLeafId) : [];
    const targetBranch = targetEntryId
      ? await storage.getPathToRoot(targetEntryId)
      : [];
    const targetIds = new Set(targetBranch.map((entry) => entry.id));
    const entriesToSummarize = oldBranch.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: "message" }> =>
        !targetIds.has(entry.id) && entry.type === "message",
    );
    if (entriesToSummarize.length === 0) return undefined;

    const summary = buildExtractiveSummary({
      title: "Branch summary",
      messages: entriesToSummarize.map((entry) => entry.message),
      instructions,
    });
    const entry = await this.appendEntry(
      {
        sessionId: session.id,
        parentEntryId: targetEntryId ?? null,
        role: "system",
        kind: "branch_summary",
        text: summary,
        summary,
        fromEntryId: oldLeafId ?? undefined,
        details: {
          generatedBy: "orchestrator-extractive",
          summarizedEntryIds: entriesToSummarize.map((item) => item.id),
          targetEntryId,
        },
      },
      { mirrorToHarness: false },
    );
    await storage.setLeafId(targetEntryId ?? null);
    await storage.appendEntry({
      type: "branch_summary",
      id: entry.id,
      parentId: targetEntryId ?? null,
      timestamp: entry.createdAt,
      fromId: oldLeafId ?? "root",
      summary,
      details: entry.details,
    });
    await this.events.publish("session.branch_summarized", {
      sessionId: session.id,
      fromEntryId: oldLeafId,
      targetEntryId,
      entry,
    });
    return entry;
  }
}

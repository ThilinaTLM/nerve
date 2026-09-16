import { createId } from "@nervekit/contracts";
import { randomUUID } from "node:crypto";
import { estimateTokens } from "@nervekit/harness/compaction";
import type {
  CanonicalConversationEntry,
  ConversationEntry,
  ConversationRecord,
  CreateConversationRequest,
  UpdateConversationStateRequest,
} from "@nervekit/contracts/conversations";
import { resolveProjectSettings } from "../../../infrastructure/configuration/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { CapabilityService } from "../../capabilities/capability.service.js";
import type { ProjectLifecycleService } from "../../projects/project.service.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../append-entry-contracts.js";
import { CanonicalManagedArtifactFinalizer } from "./canonical-managed-artifact-finalizer.js";
import { CanonicalConversationCreationService } from "./canonical-conversation-creation.service.js";
import { CanonicalConversationMetadataRepository } from "./canonical-conversation-metadata.repository.js";
import { projectCanonicalEntry } from "./canonical-entry-projection.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "./canonical-timeline-identity.service.js";
import { CanonicalNavigationService } from "./canonical-navigation.service.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { buildAppendTransition } from "./transition-builders.js";
import type { CanonicalDeletionService } from "./canonical-deletion.service.js";

function estimateCanonicalText(text: string): number {
  return estimateTokens({
    role: "harness",
    eventType: "canonical_context_entry",
    content: text,
    timestamp: 0,
  });
}

/** Production metadata facade whose history authority is the canonical timeline. */
export class CanonicalConversationApplicationService {
  private readonly metadata: CanonicalConversationMetadataRepository;
  private readonly creation: CanonicalConversationCreationService;
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;
  private readonly navigation: CanonicalNavigationService;

  constructor(
    private readonly deps: {
      storage: InitializedStorage;
      state: RuntimeState;
      queryCache: RuntimeQueryCache;
      events: StreamLogRegistry;
      projects: ProjectLifecycleService;
      capabilities: CapabilityService;
      deletion: CanonicalDeletionService;
      prepareCompactionSummary?(input: {
        conversationId: string;
        entriesDescending: readonly CanonicalConversationEntry[];
        instructions?: string;
      }): Promise<string>;
    },
  ) {
    this.metadata = new CanonicalConversationMetadataRepository(deps.storage);
    this.creation = new CanonicalConversationCreationService(
      deps.storage.canonicalStore,
    );
    this.identity = new CanonicalTimelineIdentityService(
      deps.storage.canonicalStore,
    );
    this.transitions = new ConversationTransitionService(
      deps.storage.canonicalStore,
    );
    this.navigation = new CanonicalNavigationService(
      deps.storage.canonicalStore,
    );
  }

  async loadConversations(): Promise<void> {
    for (const stored of await this.metadata.loadAll()) {
      const head =
        await this.deps.storage.canonicalStore.readTimelineConversationHead(
          stored.id,
        );
      const conversation = {
        ...stored,
        ...(head?.activeEntryId
          ? { activeEntryId: head.activeEntryId }
          : { activeEntryId: undefined }),
      };
      this.deps.state.conversations.set(conversation.id, conversation);
      this.deps.queryCache.upsertConversation(conversation);
    }
  }

  async ensureConversationEntries(
    conversationId: string,
  ): Promise<ConversationEntry[]> {
    const head =
      await this.deps.storage.canonicalStore.readTimelineConversationHead(
        conversationId,
      );
    if (!head?.activeEntryId) {
      this.deps.state.setConversationEntries(conversationId, []);
      return [];
    }
    const canonical =
      [] as import("@nervekit/contracts/conversations").CanonicalConversationEntry[];
    let next: string | undefined = head.activeEntryId;
    while (next) {
      const page =
        await this.deps.storage.canonicalStore.readTimelineAncestrySegment(
          conversationId,
          next,
          512,
        );
      canonical.push(...page.entries);
      next = page.nextAncestorEntryId;
    }
    const entries = canonical.reverse().map(projectCanonicalEntry);
    this.deps.state.setConversationEntries(conversationId, entries);
    return entries;
  }

  getConversationEntries(conversationId: string): ConversationEntry[] {
    return this.deps.state.getConversationEntries(conversationId);
  }

  getConversationTree(conversationId: string) {
    const entries = this.getConversationEntries(conversationId);
    const activeEntryId = entries.at(-1)?.id;
    return {
      conversationId,
      ...(activeEntryId ? { activeEntryId } : {}),
      rootEntryIds: entries
        .filter((entry) => !entry.parentEntryId)
        .map((entry) => entry.id),
      nodes: entries.map((entry) => ({
        entry,
        childEntryIds: entries
          .filter((candidate) => candidate.parentEntryId === entry.id)
          .map((candidate) => candidate.id),
      })),
    };
  }

  listConversations(): ConversationRecord[] {
    return this.deps.state.listConversations();
  }

  getConversation(conversationId: string): ConversationRecord {
    return this.deps.state.getConversation(conversationId);
  }

  async createConversation(
    request: CreateConversationRequest,
    options: { id?: string } = {},
  ): Promise<ConversationRecord> {
    this.deps.state.maintenanceScopes.assertProject(request.projectId);
    const project = this.deps.projects.getProject(request.projectId);
    const now = new Date().toISOString();
    const settings = await resolveProjectSettings(
      this.deps.storage,
      project.dir,
    );
    const defaults = settings.rememberLastAgentSelection
      ? settings.lastAgentSelection
      : {
          mode: "coding" as const,
          permissionLevel: settings.defaultPermissionLevel,
        };
    const conversation: ConversationRecord = {
      id: options.id ?? createId("conv"),
      projectId: request.projectId,
      title: request.title ?? "New Conversation",
      mode: request.mode ?? defaults.mode,
      permissionLevel: request.permissionLevel ?? defaults.permissionLevel,
      createdAt: now,
      updatedAt: now,
    };
    if (request.capabilityOverrides) {
      await this.deps.capabilities.writeInitialConversation(
        conversation.projectId,
        conversation.id,
        request.capabilityOverrides,
      );
    }
    const result = await this.creation.createEmpty({
      conversationId: conversation.id,
      commandId: `create-conversation:${conversation.id}`,
      now,
      metadata: conversation,
    });
    if (result.kind === "rejected") {
      await this.deps.capabilities.removeConversation(conversation.id);
      throw new Error(
        `Canonical conversation creation rejected: ${result.outcome.kind}.`,
      );
    }
    this.deps.state.conversations.set(conversation.id, conversation);
    this.deps.queryCache.upsertConversation(conversation);
    this.deps.state.setConversationEntries(conversation.id, []);
    await this.deps.events.publish("conversation.created", { conversation });
    return conversation;
  }

  async appendEntry(
    input: AppendEntryInput,
    options: AppendEntryOptions = {},
  ): Promise<ConversationEntry> {
    void options;
    if (input.id) {
      const existing = await this.findCanonicalEntry(
        input.conversationId,
        input.id,
      );
      if (existing) return projectCanonicalEntry(existing);
    }
    const head =
      await this.deps.storage.canonicalStore.readTimelineConversationHead(
        input.conversationId,
      );
    if (!head) throw new Error("Canonical conversation does not exist.");
    const createdAt = input.createdAt ?? new Date().toISOString();
    const entry: ConversationEntry = {
      id: input.id ?? createId("entry"),
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      messageOrdinal: input.messageOrdinal,
      parentEntryId:
        input.parentEntryId === null
          ? undefined
          : (input.parentEntryId ?? head.activeEntryId ?? undefined),
      role: input.role,
      kind: input.kind ?? "message",
      text: input.text,
      summary: input.summary,
      tokensBefore: input.tokensBefore,
      usage: input.usage,
      firstKeptEntryId: input.firstKeptEntryId,
      fromEntryId: input.fromEntryId,
      details: input.details,
      createdAt,
    };
    const identity = await this.identity.resolve();
    const metadataDocument =
      await this.deps.storage.canonicalStore.readDocument(
        "canonical_conversation_metadata",
        "global",
        input.conversationId,
      );
    const currentConversation = this.getConversation(input.conversationId);
    const metadataConversation: ConversationRecord = {
      ...currentConversation,
      updatedAt:
        currentConversation.updatedAt > createdAt
          ? currentConversation.updatedAt
          : createdAt,
      ...(input.role === "user"
        ? {
            lastUserMessageAt:
              currentConversation.lastUserMessageAt &&
              currentConversation.lastUserMessageAt > createdAt
                ? currentConversation.lastUserMessageAt
                : createdAt,
          }
        : {}),
    };
    delete metadataConversation.activeEntryId;
    if (input.role === "user") delete metadataConversation.completedAt;
    const fingerprint = conversationCommandFingerprint({
      operation: "append_entry",
      entry,
      metadataConversation,
    });
    const transition = buildAppendTransition({
      head,
      identity: {
        commandId: `append-entry:${entry.id}`,
        inputFingerprint: fingerprint,
        actor: { kind: input.role === "user" ? "user" : "system" },
        cause: { kind: "application_entry" },
        committedAt: createdAt,
        transitionId: `transition_${randomUUID()}`,
      },
      entries: [
        {
          entryId: entry.id,
          kind:
            entry.kind === "compaction" || entry.kind === "branch_summary"
              ? "summary"
              : entry.role === "user"
                ? "user_message"
                : "assistant_message",
          inlineContent: {
            text: entry.text,
            role: entry.role,
            summary: entry.summary,
            usage: entry.usage,
            details: entry.details,
          },
          runId: entry.runId,
          provenance: { agentId: entry.agentId, createdAt },
        },
      ],
    });
    const result = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "append_conversation_entry",
      ownerKind: "conversation",
      ownerId: input.conversationId,
      commandId: `append-entry:${entry.id}`,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: input.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      transitions: [transition],
      domainDocuments: [
        {
          namespace: "canonical_conversation_metadata",
          scopeId: "global",
          documentId: input.conversationId,
          expectedRevision: metadataDocument?.revision ?? 0,
          payloadVersion: 1,
          data: metadataConversation,
        },
      ],
      outcome: entry,
      publicationIntents: [],
      now: createdAt,
    });
    if (result.kind !== "committed" && result.kind !== "receipt_replay") {
      throw new Error(`Canonical append rejected: ${result.kind}.`);
    }
    this.deps.state.appendConversationEntry(entry);
    const conversation = {
      ...metadataConversation,
      activeEntryId: entry.id,
    };
    this.deps.state.conversations.set(input.conversationId, conversation);
    this.deps.queryCache.upsertConversation(conversation);
    return entry;
  }

  private async findCanonicalEntry(
    conversationId: string,
    entryId: string,
  ): Promise<CanonicalConversationEntry | undefined> {
    try {
      return (
        await this.deps.storage.canonicalStore.readTimelineAncestrySegment(
          conversationId,
          entryId,
          1,
        )
      ).entries[0];
    } catch {
      return undefined;
    }
  }

  async compactConversation(
    conversationId: string,
    request: { instructions?: string } = {},
    options?: unknown,
  ): Promise<{
    conversation: ConversationRecord;
    entry: ConversationEntry;
  }> {
    const reason =
      options &&
      typeof options === "object" &&
      "reason" in options &&
      typeof options.reason === "string"
        ? options.reason
        : "manual";
    const head =
      await this.deps.storage.canonicalStore.readTimelineConversationHead(
        conversationId,
      );
    if (!head?.activeEntryId) throw new Error("Nothing to compact.");
    if (head.foregroundRunId) throw new Error("Conversation is running.");
    const source =
      [] as import("@nervekit/contracts/conversations").CanonicalConversationEntry[];
    let next: string | undefined = head.activeEntryId;
    while (next) {
      const page =
        await this.deps.storage.canonicalStore.readTimelineAncestrySegment(
          conversationId,
          next,
          512,
        );
      source.push(...page.entries);
      next = page.nextAncestorEntryId;
    }
    const now = new Date().toISOString();
    const suffix = randomUUID();
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sourceEntryIds: source.map((entry) => entry.entryId),
      }),
    );
    const sourceArtifact = await new CanonicalManagedArtifactFinalizer(
      this.deps.storage.paths,
    ).finalize({
      artifactId: `artifact_${suffix}`,
      ownerKind: "conversation",
      ownerId: conversationId,
      relativeLocator: `context/${suffix}.json`,
      bytes: manifestBytes,
      mediaType: "application/json",
      semanticRole: "context_source_manifest",
    });
    await this.deps.events.publish("conversation.compaction.started", {
      conversationId,
      reason,
    });
    const summaryText = this.deps.prepareCompactionSummary
      ? await this.deps.prepareCompactionSummary({
          conversationId,
          entriesDescending: source,
          ...(request.instructions
            ? { instructions: request.instructions }
            : {}),
        })
      : source
          .slice()
          .reverse()
          .map((entry) => {
            const content = entry.inlineContent as Record<string, unknown>;
            return typeof content.text === "string" ? content.text : "";
          })
          .filter(Boolean)
          .join("\n\n")
          .slice(-64_000);
    const identity = await this.identity.resolve();
    const fingerprint = conversationCommandFingerprint({
      operation: "manual_compaction",
      conversationId,
      sourceTipEntryId: head.activeEntryId,
      sourceDigest: sourceArtifact.digest,
      summaryText,
    });
    const transition = buildAppendTransition({
      head,
      kind: "context_boundary_committed",
      identity: {
        commandId: `manual-compaction:${suffix}`,
        inputFingerprint: fingerprint,
        actor: { kind: "user" },
        cause: { kind: "manual_compaction" },
        committedAt: now,
      },
      entries: [
        {
          entryId: `entry_${suffix}`,
          kind: "summary",
          inlineContent: {
            text: summaryText,
            role: "system",
            details: {
              reason,
              generatedBy: this.deps.prepareCompactionSummary
                ? "model"
                : "orchestrator-extractive",
              tokensAfter: estimateCanonicalText(summaryText),
              freedTokens: Math.max(
                0,
                source.reduce((total, entry) => {
                  const content = entry.inlineContent as Record<
                    string,
                    unknown
                  >;
                  return (
                    total +
                    (typeof content.text === "string"
                      ? estimateCanonicalText(content.text)
                      : 0)
                  );
                }, 0) - estimateCanonicalText(summaryText),
              ),
            },
          },
          provenance: {
            sourceManifestDigest: sourceArtifact.digest,
            createdAt: now,
          },
        },
      ],
    });
    const result = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "manual_context_compaction",
      ownerKind: "conversation",
      ownerId: conversationId,
      commandId: `manual-compaction:${suffix}`,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      transitions: [transition],
      finalizedArtifacts: [sourceArtifact],
      contextBoundaries: [
        {
          schemaVersion: 1,
          boundaryId: `boundary_${suffix}`,
          conversationId,
          transitionId: transition.transitionId,
          anchorEntryId: null,
          sourceTipEntryId: head.activeEntryId,
          sourceManifest: {
            schemaVersion: 1,
            conversationId,
            sourceTipEntryId: head.activeEntryId,
            entryCount: source.length,
            entriesManifest: sourceArtifact,
            transitiveBoundaryCount: 0,
            digest: conversationCommandFingerprint({
              entriesDigest: sourceArtifact.digest,
            }),
          },
          policyVersion: 1,
          providerAdapterVersion: "manual-v1",
          recipeVersion: 1,
          visibleSummaryEntryId: transition.entries[0]!.entryId,
        },
      ],
      outcome: transition.resultingHead,
      publicationIntents: [
        {
          intentId: `evt_compaction_${suffix}`,
          stream: `conv/${conversationId}`,
          eventType: "conversation.compacted",
          occurredAt: now,
          conversationId,
          data: {
            conversationId,
            reason,
            entryId: transition.entries[0]!.entryId,
            tokensAfter: estimateCanonicalText(summaryText),
          },
        },
      ],
      now,
    });
    if (result.kind !== "committed" && result.kind !== "receipt_replay") {
      throw new Error(`Canonical compaction rejected: ${result.kind}.`);
    }
    const entries = await this.ensureConversationEntries(conversationId);
    const entry = entries.find(
      (candidate) => candidate.id === transition.entries[0]!.entryId,
    );
    if (!entry) throw new Error("Canonical summary projection is unavailable.");
    return { conversation: this.getConversation(conversationId), entry };
  }

  async cancelCompaction(conversationId?: string): Promise<void> {
    void conversationId;
    // Summary preparation is synchronous and commits once; there is no latent job.
  }

  async navigateConversation(
    conversationId: string,
    request: { activeEntryId: string | null },
  ): Promise<ConversationRecord> {
    const result = await this.navigation.select({
      conversationId,
      targetEntryId: request.activeEntryId,
      commandId: `navigate:${conversationId}:${request.activeEntryId ?? "root"}`,
      now: new Date().toISOString(),
      actor: { kind: "user" },
      cause: { kind: "navigation" },
    });
    if (result.kind === "rejected") {
      throw new Error(`Canonical navigation rejected: ${result.outcome.kind}.`);
    }
    await this.ensureConversationEntries(conversationId);
    const conversation = {
      ...this.getConversation(conversationId),
      activeEntryId: result.head.activeEntryId ?? undefined,
    };
    this.deps.state.conversations.set(conversationId, conversation);
    this.deps.queryCache.upsertConversation(conversation);
    return conversation;
  }

  async updateConversation(conversation: ConversationRecord): Promise<void> {
    await this.metadata.write(conversation);
    this.deps.state.conversations.set(conversation.id, conversation);
    this.deps.queryCache.upsertConversation(conversation);
    await this.deps.events.publish("conversation.updated", { conversation });
  }

  async updateConversationState(
    conversationId: string,
    request: UpdateConversationStateRequest,
  ): Promise<ConversationRecord> {
    const current = this.getConversation(conversationId);
    const now = new Date().toISOString();
    const next: ConversationRecord = {
      ...current,
      ...(request.pinned !== undefined ? { pinned: request.pinned } : {}),
      ...(request.completed === true ? { completedAt: now } : {}),
      ...(request.clearRuntimeStatus === true
        ? { runtimeStatusClearedAt: now }
        : {}),
      updatedAt: current.updatedAt,
    };
    if (request.completed === false) delete next.completedAt;
    await this.updateConversation(next);
    return next;
  }

  async finalizeDeletion(conversationId: string): Promise<void> {
    await this.deps.capabilities.removeConversation(conversationId);
    await this.deps.events.removeConversationStream(conversationId);
    this.deps.queryCache.removeConversation(conversationId);
    this.deps.state.removeConversation(conversationId);
  }

  async recoverDeletions(): Promise<void> {
    // The canonical deletion dispatcher resumes durable intents independently.
  }

  async removeConversation(
    conversationId: string,
    options?: unknown,
  ): Promise<void> {
    void options;
    this.getConversation(conversationId);
    const result = await this.deps.deletion.fence({
      conversationId,
      commandId: `delete-conversation:${conversationId}`,
      uncertaintyAcknowledged: false,
      now: new Date().toISOString(),
    });
    if (result.kind === "rejected") {
      throw new Error(`Canonical deletion rejected: ${result.outcome.kind}.`);
    }
  }
}

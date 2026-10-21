import {
  applyAgentProfilePatch,
  type AgentProfilesDocument,
  type AgentProfilePatch,
  type AgentProfilesConfiguration,
} from "@nervekit/contracts/agent-profiles";

import type { ConversationConfig } from "@nervekit/contracts/core";

export interface SavedConversationProfileScope {
  kind: "saved";
  projectId: string;
  conversationId: string;
}
export interface PendingConversationProfileScope {
  kind: "pending";
  projectId: string;
  pendingId: string;
  document?: AgentProfilesDocument;
  lead: Pick<ConversationConfig, "model" | "reasoningLevel">;
  /** Read at mutation time so first-send locking does not wait for an effect. */
  readonly?: () => boolean;
  onDocumentChange(document: AgentProfilesDocument): void;
}
export type ConversationProfileScope =
  | SavedConversationProfileScope
  | PendingConversationProfileScope;

export function conversationProfileScope(
  projectId: string | undefined,
  conversation:
    | { id: string; parentConversationId?: string | null }
    | undefined,
  interactive = true,
  pending?: Omit<PendingConversationProfileScope, "kind" | "projectId">,
): ConversationProfileScope | undefined {
  if (!interactive || !projectId) return;
  if (conversation)
    return conversation.parentConversationId === null
      ? { kind: "saved", projectId, conversationId: conversation.id }
      : undefined;
  return pending ? { kind: "pending", projectId, ...pending } : undefined;
}

function scopeKey(scope?: ConversationProfileScope): string | undefined {
  return (
    scope &&
    `${scope.projectId}:${scope.kind}:${scope.kind === "saved" ? scope.conversationId : scope.pendingId}`
  );
}
function pendingInputKey(scope?: ConversationProfileScope): string | undefined {
  return scope?.kind === "pending"
    ? JSON.stringify([scope.document, scope.lead])
    : undefined;
}
const emptyDocument = (): AgentProfilesDocument => ({
  schemaVersion: 1,
  profiles: {},
});

export interface ConversationProfileState {
  configuration?: AgentProfilesConfiguration;
  loading: boolean;
  saving: boolean;
  error?: string;
}
interface Dependencies {
  read(
    scope: SavedConversationProfileScope,
  ): Promise<AgentProfilesConfiguration>;
  update(
    scope: SavedConversationProfileScope,
    name: string,
    patch: AgentProfilePatch,
    expectedDigest: string | null,
  ): Promise<AgentProfilesConfiguration>;
  preview(input: {
    projectId: string;
    document: AgentProfilesDocument;
    lead: PendingConversationProfileScope["lead"];
  }): Promise<AgentProfilesConfiguration>;
  changed(state: ConversationProfileState): void;
}

/** Per-dialog state. Never changes the Settings singleton's project selection. */
export class ConversationProfileController {
  private scope?: ConversationProfileScope;
  private generation = 0;
  private mutationEpoch = 0;
  private revision = 0;
  private inputKey?: string;
  private mutationError?: string;
  private queue: Promise<void> = Promise.resolve();
  private state: ConversationProfileState = { loading: false, saving: false };
  constructor(private readonly dependencies: Dependencies) {}

  follow(scope?: ConversationProfileScope): void {
    const inputKey = pendingInputKey(scope);
    if (scopeKey(this.scope) === scopeKey(scope)) {
      this.scope = scope;
      if (inputKey !== this.inputKey) {
        this.inputKey = inputKey;
        this.revision++;
        void this.refresh();
      }
      return;
    }
    this.scope = scope;
    this.inputKey = inputKey;
    this.generation++;
    this.revision++;
    this.mutationError = undefined;
    this.publish({ loading: false, saving: false });
    if (scope) void this.refresh();
  }

  private publish(state: ConversationProfileState): void {
    this.state = state;
    this.dependencies.changed(state);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  refresh(): Promise<void> {
    const scope = this.scope;
    const generation = this.generation;
    const revision = this.revision;
    return this.enqueue(async () => {
      if (
        !scope ||
        generation !== this.generation ||
        revision !== this.revision
      )
        return;
      this.publish({ ...this.state, loading: true });
      try {
        const configuration =
          scope.kind === "saved"
            ? await this.dependencies.read(scope)
            : await this.dependencies.preview({
                projectId: scope.projectId,
                document: scope.document ?? emptyDocument(),
                lead: scope.lead,
              });
        if (generation === this.generation && revision === this.revision)
          this.publish({
            configuration,
            loading: false,
            saving: false,
            error: this.mutationError,
          });
      } catch (error) {
        if (generation === this.generation && revision === this.revision)
          this.publish({
            ...this.state,
            loading: false,
            saving: false,
            error: String(error),
          });
      }
    });
  }

  mutate(name: string, patch: AgentProfilePatch): Promise<void> {
    const pending = this.scope;
    if (pending?.kind === "pending") {
      if (
        pending.readonly?.() ||
        !this.state.configuration ||
        this.state.configuration.diagnostics.some(
          (d) => d.severity === "blocking",
        )
      )
        return Promise.resolve();
      const document = applyAgentProfilePatch(
        pending.document ?? emptyDocument(),
        name,
        patch,
      );
      // Commit to the draft owner before any asynchronous preview (or Send).
      this.scope = { ...pending, document };
      this.inputKey = pendingInputKey(this.scope);
      this.revision++;
      pending.onDocumentChange(document);
      this.publish({ ...this.state, error: undefined });
      return this.refresh();
    }
    const epoch = this.mutationEpoch;
    const scope = this.scope;
    const generation = this.generation;
    return this.enqueue(async () => {
      if (
        !scope ||
        scope.kind !== "saved" ||
        generation !== this.generation ||
        epoch !== this.mutationEpoch ||
        !this.state.configuration
      )
        return;
      // Invalid documents must not be overwritten by an incidental control edit.
      if (
        this.state.configuration.diagnostics.some(
          (d) => d.severity === "blocking",
        )
      )
        return;
      this.mutationError = undefined;
      this.publish({ ...this.state, saving: true, error: undefined });
      try {
        const configuration = await this.dependencies.update(
          scope,
          name,
          patch,
          this.state.configuration.digest,
        );
        if (generation === this.generation)
          this.publish({ configuration, loading: false, saving: false });
      } catch (error) {
        if (generation !== this.generation) return;
        this.mutationEpoch++;
        // Never replay a conflicting edit (including queued edits) against unseen content.
        const message = `${String(error)}. Your change was not saved. Review the refreshed values and try again.`;
        this.mutationError = message;
        try {
          const configuration = await this.dependencies.read(scope);
          if (generation === this.generation)
            this.publish({
              configuration,
              loading: false,
              saving: false,
              error: message,
            });
        } catch (readError) {
          if (generation === this.generation)
            this.publish({
              ...this.state,
              saving: false,
              error: `${message} Refresh failed: ${String(readError)}`,
            });
        }
      }
    });
  }
}

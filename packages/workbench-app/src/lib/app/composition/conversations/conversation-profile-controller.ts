import type {
  SubagentProfilePatch,
  SubagentProfilesConfiguration,
} from "@nervekit/contracts/subagents";

export interface ConversationProfileScope {
  projectId: string;
  conversationId: string;
}
export function conversationProfileScope(
  projectId: string | undefined,
  conversation:
    | { id: string; parentConversationId?: string | null }
    | undefined,
  interactive = true,
): ConversationProfileScope | undefined {
  return interactive && projectId && conversation?.parentConversationId === null
    ? { projectId, conversationId: conversation.id }
    : undefined;
}

export interface ConversationProfileState {
  configuration?: SubagentProfilesConfiguration;
  loading: boolean;
  saving: boolean;
  error?: string;
}
interface Dependencies {
  read(scope: ConversationProfileScope): Promise<SubagentProfilesConfiguration>;
  update(
    scope: ConversationProfileScope,
    name: string,
    patch: SubagentProfilePatch,
    expectedDigest: string | null,
  ): Promise<SubagentProfilesConfiguration>;
  changed(state: ConversationProfileState): void;
}

/** Per-dialog state. Never changes the Settings singleton's project selection. */
export class ConversationProfileController {
  private scope?: ConversationProfileScope;
  private generation = 0;
  private mutationEpoch = 0;
  private mutationError?: string;
  private queue: Promise<void> = Promise.resolve();
  private state: ConversationProfileState = { loading: false, saving: false };
  constructor(private readonly dependencies: Dependencies) {}

  follow(scope?: ConversationProfileScope): void {
    if (
      this.scope?.conversationId === scope?.conversationId &&
      this.scope?.projectId === scope?.projectId
    )
      return;
    this.scope = scope;
    this.generation++;
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
    return this.enqueue(async () => {
      if (!scope || generation !== this.generation) return;
      this.publish({ ...this.state, loading: true });
      try {
        const configuration = await this.dependencies.read(scope);
        if (generation === this.generation)
          this.publish({
            configuration,
            loading: false,
            saving: false,
            error: this.mutationError,
          });
      } catch (error) {
        if (generation === this.generation)
          this.publish({ ...this.state, loading: false, error: String(error) });
      }
    });
  }

  mutate(name: string, patch: SubagentProfilePatch): Promise<void> {
    const epoch = this.mutationEpoch;
    const scope = this.scope;
    const generation = this.generation;
    return this.enqueue(async () => {
      if (
        !scope ||
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

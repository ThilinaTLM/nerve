import {
  applyCapabilityPatch,
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
  type CapabilityConfiguration,
  type CapabilityOverridesDocument,
  type CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import {
  composerSkillRows,
  type ComposerSkillRow,
} from "$lib/domain/skills/skill-catalog";

export type ComposerCapabilityScope =
  | {
      kind: "conversation";
      key: string;
      projectId: string;
      conversationId: string;
    }
  | {
      kind: "pending";
      key: string;
      projectId: string;
      pendingId: string;
      overrides?: CapabilityOverridesDocument;
      onOverridesChange: (overrides: CapabilityOverridesDocument) => void;
    };

export type ComposerCapabilityState = {
  configuration?: CapabilityConfiguration;
  skills: ComposerSkillRow[];
  loading: boolean;
  mutating: boolean;
  error?: string;
};

type Dependencies = {
  getConfiguration: (
    projectId: string,
    conversationId?: string,
  ) => Promise<CapabilityConfiguration>;
  listSkills: (projectId: string) => Promise<{ skills: AvailableSkill[] }>;
  updateConfiguration: (input: {
    projectId: string;
    conversationId: string;
    origin: "conversation";
    patch?: CapabilityPatch;
    replace?: CapabilityOverridesDocument;
    expectedDigest?: string;
  }) => Promise<CapabilityConfiguration>;
  onStateChange: (state: ComposerCapabilityState) => void;
};

type ScopeContext = {
  scope: ComposerCapabilityScope;
  configuration?: CapabilityConfiguration;
  baseConfiguration?: CapabilityConfiguration;
  availableSkills: AvailableSkill[];
  skills: ComposerSkillRow[];
  loadCount: number;
  mutationCount: number;
  error?: string;
  tail: Promise<void>;
  pendingRefresh?: Promise<void>;
};

const emptyState = (): ComposerCapabilityState => ({
  skills: [],
  loading: false,
  mutating: false,
});

/**
 * Owns composer capability I/O for one active scope at a time. Operations are
 * serialized per scope, while results from scopes that have been navigated
 * away from are never published back into the composer.
 */
export class ComposerCapabilityController {
  #context?: ScopeContext;

  constructor(private readonly dependencies: Dependencies) {
    dependencies.onStateChange(emptyState());
  }

  setScope(scope: ComposerCapabilityScope | undefined): void {
    if (this.#context?.scope.key === scope?.key) return;
    if (!scope) {
      this.#context = undefined;
      this.dependencies.onStateChange(emptyState());
      return;
    }
    const normalizedScope =
      scope.kind === "pending" && scope.overrides
        ? {
            ...scope,
            overrides: capabilityOverridesDocumentSchema.parse(scope.overrides),
          }
        : scope;
    const context: ScopeContext = {
      scope: normalizedScope,
      availableSkills: [],
      skills: [],
      loadCount: 0,
      mutationCount: 0,
      tail: Promise.resolve(),
    };
    this.#context = context;
    this.#publish(context);
    void this.refresh();
  }

  refresh(): Promise<void> {
    const context = this.#context;
    if (!context) return Promise.resolve();
    if (context.pendingRefresh) return context.pendingRefresh;

    context.loadCount += 1;
    context.error = undefined;
    this.#publish(context);
    const operation = this.#enqueue(context, async () => {
      context.pendingRefresh = undefined;
      try {
        await this.#load(context);
        context.error = undefined;
      } catch (error) {
        context.error = errorMessage(error);
      } finally {
        context.loadCount -= 1;
        this.#publish(context);
      }
    });
    context.pendingRefresh = operation;
    return operation;
  }

  patch(patch: CapabilityPatch): Promise<void> {
    const context = this.#context;
    if (!context) return Promise.resolve();
    if (context.scope.kind === "pending") {
      this.#setPendingOverrides(
        context,
        applyCapabilityPatch(
          context.scope.overrides ?? emptyCapabilityOverrides(),
          patch,
        ),
      );
      return Promise.resolve();
    }
    return this.#mutate(context, { patch });
  }

  reset(): Promise<void> {
    const context = this.#context;
    if (!context) return Promise.resolve();
    const replacement = emptyCapabilityOverrides();
    if (context.scope.kind === "pending") {
      this.#setPendingOverrides(context, replacement);
      return Promise.resolve();
    }
    return this.#mutate(context, { replace: replacement });
  }

  #mutate(
    context: ScopeContext,
    change:
      | { patch: CapabilityPatch; replace?: never }
      | { patch?: never; replace: CapabilityOverridesDocument },
  ): Promise<void> {
    const scope = context.scope;
    if (scope.kind !== "conversation") return Promise.resolve();
    context.mutationCount += 1;
    context.error = undefined;
    this.#publish(context);
    return this.#enqueue(context, async () => {
      try {
        const configuration = context.configuration;
        if (!configuration)
          throw new Error("Capability configuration is not loaded.");
        context.configuration = await this.dependencies.updateConfiguration({
          projectId: scope.projectId,
          conversationId: scope.conversationId,
          origin: "conversation",
          ...change,
          expectedDigest: configuration.conversationDigest,
        });
        context.skills = this.#buildSkillRows(context);
        context.error = undefined;
      } catch (error) {
        const mutationError = errorMessage(error);
        try {
          await this.#load(context);
        } catch {
          // Preserve the actionable mutation failure. A later refresh can retry
          // loading if canonical reconciliation is temporarily unavailable.
        }
        context.error = mutationError;
      } finally {
        context.mutationCount -= 1;
        this.#publish(context);
      }
    });
  }

  async #load(context: ScopeContext): Promise<void> {
    const conversationId =
      context.scope.kind === "conversation"
        ? context.scope.conversationId
        : undefined;
    const [base, available] = await Promise.all([
      this.dependencies.getConfiguration(
        context.scope.projectId,
        conversationId,
      ),
      this.dependencies.listSkills(context.scope.projectId),
    ]);
    context.baseConfiguration = base;
    context.availableSkills = available.skills;
    context.configuration =
      context.scope.kind === "pending"
        ? configurationWithPendingOverrides(base, context.scope.overrides)
        : base;
    context.skills = this.#buildSkillRows(context);
  }

  #setPendingOverrides(
    context: ScopeContext,
    overrides: CapabilityOverridesDocument,
  ): void {
    if (context.scope.kind !== "pending") return;
    context.scope.overrides = overrides;
    context.scope.onOverridesChange(overrides);
    if (context.baseConfiguration) {
      context.configuration = configurationWithPendingOverrides(
        context.baseConfiguration,
        overrides,
      );
      context.skills = this.#buildSkillRows(context);
    }
    context.error = undefined;
    this.#publish(context);
  }

  #buildSkillRows(context: ScopeContext): ComposerSkillRow[] {
    const configuration = context.configuration;
    if (!configuration) return [];
    return composerSkillRows({
      skills: context.availableSkills,
      selection: configuration.effective,
      project:
        configuration.trust.status === "trusted"
          ? configuration.project
          : undefined,
      conversation: configuration.conversation,
    });
  }

  #enqueue(
    context: ScopeContext,
    operation: () => Promise<void>,
  ): Promise<void> {
    const result = context.tail.then(operation, operation);
    context.tail = result.catch(() => undefined);
    return result;
  }

  #publish(context: ScopeContext): void {
    if (this.#context !== context) return;
    this.dependencies.onStateChange({
      ...(context.configuration
        ? { configuration: context.configuration }
        : {}),
      skills: context.skills,
      loading: context.loadCount > 0,
      mutating: context.mutationCount > 0,
      ...(context.error ? { error: context.error } : {}),
    });
  }
}

function configurationWithPendingOverrides(
  base: CapabilityConfiguration,
  overrides: CapabilityOverridesDocument | undefined,
): CapabilityConfiguration {
  if (!overrides) return base;
  return {
    ...base,
    conversation: overrides,
    effective: resolveCapabilitySelection({
      user: base.effective,
      conversation: overrides,
    }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

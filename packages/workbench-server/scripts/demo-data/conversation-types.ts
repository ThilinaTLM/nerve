/**
 * Declarative demo conversations for website screenshots.
 *
 * A conversation is a linear `steps` list plus optional `branches` that fork
 * from an earlier step index. That mirrors how branching actually works in the
 * product — navigate to an earlier entry, continue from there — so the seeded
 * history graph is the real shape, not a drawing of one.
 */

export type DemoStep =
  | { readonly type: "user"; readonly text: string }
  | {
      readonly type: "assistant";
      readonly text: string;
      readonly thinking?: string;
    }
  | {
      readonly type: "tool";
      readonly toolName: string;
      readonly risk:
        | "read"
        | "workspace_write"
        | "command"
        | "network"
        | "agent_spawn";
      readonly repo?: string;
      readonly args: unknown;
      readonly result: unknown;
    }
  | { readonly type: "compaction"; readonly text: string }
  | { readonly type: "agent_report"; readonly text: string };

export interface DemoBranch {
  /** Index into `steps` the branch continues from. */
  readonly fromStep: number;
  readonly steps: readonly DemoStep[];
}

export interface DemoConversation {
  readonly title: string;
  readonly agentProfile: string;
  readonly permissionRuleSetId: "read_only" | "supervised" | "autonomous";
  /** Hours before the seed clock that this conversation started. */
  readonly ageHours: number;
  readonly pinned?: boolean;
  readonly completed?: boolean;
  /**
   * Terminal or in-flight execution state recorded after the steps. `running`
   * leaves an open execution; recovery on daemon start may convert it.
   */
  readonly outcome?: "interrupted" | "failed";
  /** GitHub references written the way prompt/PR-creation extraction would. */
  readonly references?: readonly {
    readonly kind: "pull_request" | "issue";
    readonly repository: string;
    readonly number: number;
    readonly relationship: "referenced" | "created";
  }[];
  /** Unified retained sub-agents, created with named profiles. */
  readonly children?: readonly {
    readonly name: string;
    readonly profile: string;
    readonly task: string;
    readonly report: string;
  }[];
  readonly asyncCommand?: string;
  /** Pending choice rendered by the real ask_user card, without a model call. */
  readonly question?: {
    readonly question: string;
    readonly options: readonly {
      readonly label: string;
      readonly description: string;
      readonly recommended?: boolean;
    }[];
  };
  readonly steps: readonly DemoStep[];
  readonly branches?: readonly DemoBranch[];
}

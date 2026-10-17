import type { ToolName } from "@nervekit/contracts/tools";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { MetaItem, PrimaryArg } from "../../cards/card-presentation";
import type { ToolArgumentSource } from "./argument-source";

export type ToolLifecycleStage =
  | "drafting"
  | "approval"
  | "executing"
  | "failed"
  | "completed";

export type ToolArgumentBody =
  | {
      kind: "entities";
      items: Array<{
        key: string;
        title?: string;
        detail?: string;
        body?: string;
        status?: { tone: StatusTone; label: string };
        followUp?: boolean;
        agentName?: string;
      }>;
      context?: { label: string; text?: string };
    }
  | {
      kind: "diff-sections";
      sections: Array<{
        key: string;
        caption?: string;
        text?: string;
        status?: "failed" | "not_applied";
      }>;
      tail?: boolean;
    }
  | { kind: "none" }
  | {
      kind: "code";
      text: string;
      language: "bash" | "python" | "text" | "json";
      label?: string;
      tail?: boolean;
    }
  | { kind: "diff"; text: string; label?: string; tail?: boolean }
  | {
      kind: "key-values";
      items: Array<{
        label: string;
        value: string;
        mono?: boolean;
        tone?: MetaItem["tone"];
      }>;
    }
  | {
      kind: "checklist";
      items: Array<{ text: string; done: boolean }>;
    }
  | { kind: "text-summary"; text: string; label?: string; mono?: boolean }
  | { kind: "atlassian-summary"; text: string }
  | {
      kind: "atlassian-draft";
      /** Ordered field rows; `value === undefined` means expected/pending. */
      fields: Array<{
        label: string;
        value?: string;
        mono?: boolean;
        tone?: MetaItem["tone"];
      }>;
      /** Long-form section; `text === undefined` means not yet streamed. */
      text?: { label: string; text?: string; language?: "xml" };
    };

export type ToolArgumentPresentation = {
  primaryArg?: PrimaryArg;
  secondary: MetaItem[];
  body: ToolArgumentBody;
  safetyNotes: string[];
};

/**
 * How the card's persistent argument section behaves across the lifecycle:
 * - `persistent`: argument body stays mounted in every state, including
 *   completed (the completed view must not render it again). Entity/diff
 *   sections use String(arrayIndex) keys across all stages; result views only
 *   append output, never recreate these rows. Entity agentName enables live
 *   enrichment without transferring ownership to the result view.
 * - `until-result`: argument body stays mounted through drafting, approval,
 *   and execution, and is replaced once the result section shows output.
 * - `until-settled`: like `until-result`, but also hides input context when
 *   the call fails, is denied, or is cancelled.
 * - `none`: no argument section; approval-stage bodies render inside the
 *   approval prompt instead.
 */
export type ToolArgumentRegion =
  | "persistent"
  | "until-result"
  | "until-settled"
  | "none";

/** Executing-state placeholder rendered in the result section. */
export type ToolResultPlaceholder = {
  variant: "text" | "list" | "image" | "links";
  /** Image aspect ratio from the size argument, e.g. 1024x576. */
  ratio?: string;
  rows: number;
};

export type CompletedViewFamily =
  | "generic"
  | "read"
  | "bash"
  | "python"
  | "edit"
  | "write"
  | "grep"
  | "find"
  | "ls"
  | "ask_user"
  | "todos"
  | "subagent"
  | "plan_mode"
  | "jira"
  | "confluence"
  | "web_search"
  | "web_fetch"
  | "explain_image"
  | "generate_image"
  | "kroki_export";

export type ToolLifecycleSpec<Name extends ToolName = ToolName> = {
  name: Name;
  argumentRegion: ToolArgumentRegion;
  completedView: CompletedViewFamily;
  /** Placeholder shown while executing without durable output. */
  resultPlaceholder?: ToolResultPlaceholder;
  emptyResult?: string;
  present: (
    source: ToolArgumentSource,
    stage: ToolLifecycleStage,
    cwd?: string,
  ) => ToolArgumentPresentation;
};

export type UnknownToolLifecycleSpec = Omit<
  ToolLifecycleSpec,
  "name" | "completedView"
> & {
  name: "unknown";
  completedView: "generic";
};

export const noArgumentBody = (): ToolArgumentBody => ({ kind: "none" });

export function argumentPresentation(
  input: Partial<Omit<ToolArgumentPresentation, "body">> & {
    body?: ToolArgumentBody;
  } = {},
): ToolArgumentPresentation {
  return {
    primaryArg: input.primaryArg,
    secondary: (input.secondary ?? []).map((item) => ({
      ...item,
      key: item.key ?? `arg:${item.text.replace(/\d+(?:\.\d+)?/g, "#")}`,
    })),
    body: input.body ?? noArgumentBody(),
    safetyNotes: input.safetyNotes ?? [],
  };
}

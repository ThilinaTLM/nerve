import type { PrimaryArg } from "./tool-presentation";
import type { ToolLifecycleVisualStage } from "./tool-activity-state";

export function toolPrimaryArgShape(arg: PrimaryArg | undefined): string {
  if (!arg) return "none";
  const kind = arg.openPath ? "file" : arg.href ? "link" : "text";
  return `${kind}:${arg.preserveWhitespace ? "preserve" : "wrap"}`;
}

/**
 * Full-card structural milestone. Raw argument text is intentionally excluded
 * so streamed deltas do not restart geometry motion for every token.
 */
export function toolCardLayoutRevision(input: {
  stage: ToolLifecycleVisualStage;
  activityRevision: string;
  badge: string;
  arg?: PrimaryArg;
}): string {
  return [
    input.stage,
    input.activityRevision,
    `badge:${input.badge}`,
    `arg:${toolPrimaryArgShape(input.arg)}`,
  ].join("|");
}

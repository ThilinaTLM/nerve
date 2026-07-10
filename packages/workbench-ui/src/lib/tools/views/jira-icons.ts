import BookMarked from "@lucide/svelte/icons/book-marked";
import Bug from "@lucide/svelte/icons/bug";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import ChevronsDown from "@lucide/svelte/icons/chevrons-down";
import ChevronsUp from "@lucide/svelte/icons/chevrons-up";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import Equal from "@lucide/svelte/icons/equal";
import GitBranch from "@lucide/svelte/icons/git-branch";
import SquareCheckBig from "@lucide/svelte/icons/square-check-big";
import Zap from "@lucide/svelte/icons/zap";
import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import type { Component } from "svelte";
import { jiraPriorityTone } from "./jira-display";

/** Map an issue type name to a representative lucide icon. */
export function jiraIssueTypeIcon(issueType?: string): Component {
  const name = issueType?.toLowerCase() ?? "";
  if (name.includes("epic")) return Zap;
  if (name.includes("story")) return BookMarked;
  if (name.includes("bug")) return Bug;
  if (name.includes("subtask") || name.includes("sub-task")) return GitBranch;
  if (name.includes("task")) return SquareCheckBig;
  return CircleDot;
}

/**
 * Map a priority name to an icon + tone. Returns `undefined` for unknown or
 * absent priorities so callers can omit the chip entirely.
 */
export function jiraPriorityMeta(
  priority?: string,
): { icon: Component; tone: BadgeTone } | undefined {
  const tone = jiraPriorityTone(priority);
  if (!tone) return undefined;
  // A defined tone guarantees one of the known priority keys below.
  const icons: Record<string, Component> = {
    highest: ChevronsUp,
    high: ChevronUp,
    medium: Equal,
    low: ChevronDown,
    lowest: ChevronsDown,
  };
  return { icon: icons[priority?.toLowerCase() ?? ""], tone };
}

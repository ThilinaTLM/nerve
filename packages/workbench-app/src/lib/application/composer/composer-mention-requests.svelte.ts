import { activeComposer } from "./active-composer.svelte";

/**
 * Mentions requested from outside the composer (for example "Mention in
 * conversation" in the Files panel). The mounted composer drains the queue and
 * inserts each path as an `@path` chip.
 */
export const composerMentionRequests = $state({ paths: [] as string[] });

/** Queues path references; false when no composer is available to take them. */
export function requestComposerMentions(references: readonly string[]): boolean {
  if (references.length === 0) return true;
  if (!activeComposer()) return false;
  composerMentionRequests.paths = [
    ...composerMentionRequests.paths,
    ...references,
  ];
  return true;
}

export function takeComposerMentionRequests(): string[] {
  const taken = composerMentionRequests.paths;
  composerMentionRequests.paths = [];
  return taken;
}

import type { ComposerDragReference } from "$lib/presentation/dnd/composer-reference-drag";
import { formatProjectEntryReference } from "$lib/presentation/dnd/project-entry-drag";
import type { ComposerReference } from "./composer-editor-api";
import { pathMentionReference } from "./composer-path-references";

/** `@launch:<id>`, as inserted by the launch completion source. */
export function launchMentionReference(
  id: string,
  label: string,
  title?: string,
): ComposerReference {
  return {
    insert: `@launch:${id}`,
    label,
    kind: "launch_definition",
    title: title ?? `@launch:${id}`,
  };
}

/** Mention chips for a dropped internal drag payload. */
export function composerReferencesFromDrag(
  references: readonly ComposerDragReference[],
): ComposerReference[] {
  return references.map((reference) =>
    reference.type === "launch"
      ? launchMentionReference(reference.id, reference.label, reference.title)
      : pathMentionReference(formatProjectEntryReference(reference)),
  );
}

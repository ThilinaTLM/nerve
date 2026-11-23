import {
  normalizeProjectEntryDragItem,
  type ProjectEntryDragItem,
} from "./project-entry-drag";

/**
 * The single internal drag payload for things the prompt composer can mention.
 * Sources (the Files tree, the Launches tree, …) serialize references into it;
 * the composer turns them into the same mention chips its completion menu
 * inserts. Add a reference `type` here and handle it in the composer's
 * `composerReferencesFromDrag` to make another kind draggable.
 */
export const COMPOSER_REFERENCE_DRAG_MIME =
  "application/x-nerve-composer-references";

export type ComposerDragReference =
  | ({ type: "project-entry" } & ProjectEntryDragItem)
  | {
      type: "launch";
      /** Launch definition id, as in `@launch:<id>`. */
      id: string;
      /** Chip text. */
      label: string;
      /** Hover text, e.g. the command. */
      title?: string;
    };

type ComposerReferenceDragPayload = {
  version: 1;
  references: readonly ComposerDragReference[];
};

/** Same grammar the composer recognizes after `@launch:`. */
const LAUNCH_ID = /^\w[\w.:/-]*$/;

function normalizeReference(value: unknown): ComposerDragReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const reference = value as Record<string, unknown>;
  if (reference.type === "project-entry") {
    const entry = normalizeProjectEntryDragItem(reference);
    return entry && { type: "project-entry", ...entry };
  }
  if (reference.type === "launch") {
    const { id, label, title } = reference;
    if (
      typeof id !== "string" ||
      !LAUNCH_ID.test(id) ||
      typeof label !== "string" ||
      label.length === 0 ||
      (title !== undefined && typeof title !== "string")
    )
      return undefined;
    return { type: "launch", id, label, ...(title ? { title } : {}) };
  }
  return undefined;
}

export function projectEntryDragReferences(
  entries: readonly ProjectEntryDragItem[],
): ComposerDragReference[] {
  return entries.map((entry) => ({ type: "project-entry", ...entry }));
}

export function serializeComposerReferenceDrag(
  references: readonly ComposerDragReference[],
): string {
  const normalized = references.map(normalizeReference);
  if (
    normalized.length === 0 ||
    !normalized.every(
      (reference): reference is ComposerDragReference =>
        reference !== undefined,
    )
  )
    throw new Error("Composer drag payload contains invalid references.");
  return JSON.stringify({
    version: 1,
    references: normalized,
  } satisfies ComposerReferenceDragPayload);
}

export function parseComposerReferenceDrag(
  value: string,
): ComposerDragReference[] | undefined {
  if (!value) return undefined;
  try {
    const payload: unknown = JSON.parse(value);
    if (!payload || typeof payload !== "object") return undefined;
    const { version, references: raw } = payload as Record<string, unknown>;
    if (version !== 1 || !Array.isArray(raw) || raw.length === 0)
      return undefined;
    const references = raw.map(normalizeReference);
    return references.every(
      (reference): reference is ComposerDragReference =>
        reference !== undefined,
    )
      ? references
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasComposerReferenceDragType(
  types: readonly string[],
): boolean {
  return types.includes(COMPOSER_REFERENCE_DRAG_MIME);
}

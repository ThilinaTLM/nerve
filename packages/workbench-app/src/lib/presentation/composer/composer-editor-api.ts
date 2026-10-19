import type { CompletionKind } from "@nervekit/contracts/completions";

/**
 * Imperative handle the prompt editor exposes to its host (via an `onReady`
 * prop) for content that originates outside the text itself: toolbar
 * attachments and voice dictation. Keeps CodeMirror internals private.
 */
export type ComposerEditorApi = {
  /**
   * Insert references at the current caret (end of document when the editor
   * has never had a caret), each rendered as an atomic chip. `insert` is the
   * exact text serialized into the prompt; `label` is what the chip shows.
   */
  insertReferences(references: readonly ComposerReference[]): void;
  /**
   * Place a dictation placeholder chip at the current caret (or replace the
   * selection). Only one may exist; starting again returns the live handle.
   */
  startDictation(): ComposerDictationHandle;
};

export type ComposerReference = {
  insert: string;
  label: string;
  kind: CompletionKind | "image";
  /** Full path/URL shown on hover. */
  title?: string;
};

export type ComposerDictationState = "recording" | "transcribing" | "failed";

export type ComposerDictationHandle = {
  /** Fixed-width chip: changing state or elapsed time never reflows text. */
  update(state: ComposerDictationState, elapsedMs: number): void;
  /** Replace the chip with text (smart spacing), as one undoable change. */
  resolve(text: string): void;
  /** Remove the chip without inserting anything. */
  cancel(): void;
  /** False once resolved, cancelled, or deleted by the user. */
  readonly active: boolean;
  /** Called when the user deletes the chip (Backspace/Delete/cut). */
  onRemoved(listener: () => void): () => void;
};

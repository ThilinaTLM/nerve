import type { ConversationEntry } from "$lib/presentation/view-models/conversation";
import type { ComposerView } from "$lib/application/composer/composer-view.svelte";
import type {
  conversationDraftStore,
  PromptDraftTarget,
} from "$lib/application/workspace/conversation-draft-store";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import {
  runActivePaneAction,
  submitPendingPrompt,
} from "./prompt-submission.svelte";

/** The slice of the conversation store the composer session acts on. */
type SessionStore = {
  selectHead(id: string | null): Promise<unknown>;
  submit(text: string): Promise<unknown>;
  control(action: "stop"): Promise<unknown>;
  retryResponse(): Promise<unknown>;
};

export type ComposerSessionDependencies = {
  store: () => SessionStore | undefined;
  promptDraftTarget: () => PromptDraftTarget | undefined;
  pending: () => PendingConversationState | undefined;
  viewedChildId: () => string | undefined;
  inherited: () => ComposerView["inherited"];
  drafts: ReturnType<typeof conversationDraftStore>;
  focusComposer: () => void;
};

/**
 * Composer session for one conversation pane: owns the edit-target state
 * (an entry being rewritten replaces the persisted draft as composer text)
 * and the actions that read or change it.
 */
export class ComposerSession {
  editTarget = $state<ConversationEntry>();
  editText = $state("");
  retryingResponse = $state(false);
  readonly #deps: ComposerSessionDependencies;

  constructor(deps: ComposerSessionDependencies) {
    this.#deps = deps;
  }

  /** The text the composer shows: the edit buffer or the persisted draft. */
  get composerText(): string {
    if (this.editTarget) return this.editText;
    const target = this.#deps.promptDraftTarget();
    return target ? this.#deps.drafts.getPrompt(target) : "";
  }

  clearEdit(): void {
    this.editTarget = undefined;
  }

  setComposerText = (text: string): void => {
    if (this.editTarget) {
      this.editText = text;
      return;
    }
    const target = this.#deps.promptDraftTarget();
    if (target) this.#deps.drafts.setPrompt(target, text);
  };

  editEntry = (entry: ConversationEntry): void => {
    this.editTarget = entry;
    this.editText = entry.text;
    this.#deps.focusComposer();
  };

  applySuggestion = (suggestion: { prompt: string }): void => {
    const text = this.composerText;
    this.setComposerText(
      text.trim() ? `${text}\n\n${suggestion.prompt}` : suggestion.prompt,
    );
  };

  sendSuggestion = (suggestion: { prompt: string }): void => {
    void runActivePaneAction(() =>
      this.submit(suggestion.prompt, { clearComposer: false }),
    );
  };

  submit = async (
    text = this.composerText,
    options: { clearComposer?: boolean } = {},
  ): Promise<void> => {
    if (!text.trim() || this.#deps.viewedChildId()) return;
    const pending = this.#deps.pending();
    if (pending) {
      await submitPendingPrompt({
        pending,
        text,
        inherited: this.#deps.inherited(),
        drafts: this.#deps.drafts,
        clearComposer: options.clearComposer !== false,
      });
      return;
    }
    const store = this.#deps.store();
    const submittingEdit = this.editTarget;
    const submittingTarget = this.#deps.promptDraftTarget();
    if (!store) return;
    if (submittingEdit)
      await store.selectHead(submittingEdit.parentEntryId ?? null);
    await store.submit(text);
    if (!submittingEdit && submittingTarget && options.clearComposer !== false)
      this.#deps.drafts.clearPromptIfUnchanged(submittingTarget, text);
    if (
      this.editTarget === submittingEdit &&
      (!submittingEdit || this.editText === text)
    )
      this.editTarget = undefined;
  };

  abortActiveRun = async (): Promise<void> => {
    await this.#deps.store()?.control("stop");
  };

  retryActiveResponse = async (): Promise<void> => {
    if (this.retryingResponse) return;
    this.retryingResponse = true;
    try {
      await this.#deps.store()?.retryResponse();
    } finally {
      this.retryingResponse = false;
    }
  };
}

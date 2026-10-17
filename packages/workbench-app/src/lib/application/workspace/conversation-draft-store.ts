import { SvelteMap } from "svelte/reactivity";
import type {
  AskUserAnswerDraft,
  AskUserDraftStore,
} from "$lib/presentation/tools/tool-call/ask-user-state";

const STORAGE_KEY = "nerve:conversation-drafts:v1";
const MAX_ENTRIES = 50;
export type PromptDraftTarget =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string; projectId: string };
type Entry = { updatedAt: number } & (
  | { kind: "ask-user"; questions: Record<string, AskUserAnswerDraft> }
  | { kind: "prompt"; target: PromptDraftTarget; text: string }
);
type DraftStorage = Pick<Storage, "getItem" | "setItem">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function promptKey(target: PromptDraftTarget): string {
  return `${target.kind}:${target.id}`;
}

/** Synchronous persistence: reads, submit and pagehide never race a debounce. */
export class PersistentConversationDraftStore implements AskUserDraftStore {
  readonly #entries = new SvelteMap<string, Entry>();

  constructor(private readonly storage?: DraftStorage) {
    try {
      const saved = record(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null"));
      for (const [key, raw] of Object.entries(saved)) {
        const entry = record(raw);
        const updatedAt = entry.updatedAt;
        if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt))
          continue;
        if (entry.kind === "ask-user" && key.startsWith("ask-user:")) {
          const questions = Object.fromEntries(
            Object.entries(record(entry.questions)).flatMap(
              ([questionId, value]) => {
                const draft = record(value);
                const answer = {
                  ...(typeof draft.option === "string"
                    ? { option: draft.option }
                    : {}),
                  ...(typeof draft.text === "string"
                    ? { text: draft.text }
                    : {}),
                };
                return Object.keys(answer).length ? [[questionId, answer]] : [];
              },
            ),
          );
          if (Object.keys(questions).length)
            this.#entries.set(key, { kind: "ask-user", updatedAt, questions });
        } else if (
          entry.kind === "prompt" &&
          typeof entry.text === "string" &&
          entry.text
        ) {
          const rawTarget = record(entry.target);
          if (typeof rawTarget.id !== "string" || !rawTarget.id) continue;
          let target: PromptDraftTarget;
          if (rawTarget.kind === "conversation")
            target = { kind: "conversation", id: rawTarget.id };
          else if (
            rawTarget.kind === "pending-conversation" &&
            typeof rawTarget.projectId === "string"
          ) {
            target = {
              kind: "pending-conversation",
              id: rawTarget.id,
              projectId: rawTarget.projectId,
            };
          } else continue;
          if (key === promptKey(target))
            this.#entries.set(key, {
              kind: "prompt",
              updatedAt,
              target,
              text: entry.text,
            });
        }
      }
      const loadedCount = this.#entries.size;
      this.#prune();
      if (this.#entries.size !== loadedCount) this.#persist();
    } catch {
      // Invalid or unavailable browser storage must not prevent composing.
    }
  }

  get(toolCallId: string): Record<string, AskUserAnswerDraft> {
    const entry = this.#entries.get(`ask-user:${toolCallId}`);
    return entry?.kind === "ask-user" ? entry.questions : {};
  }

  update(
    toolCallId: string,
    questionId: string,
    patch: Partial<AskUserAnswerDraft>,
  ): void {
    const questions = this.get(toolCallId);
    this.#save(`ask-user:${toolCallId}`, {
      kind: "ask-user",
      updatedAt: Date.now(),
      questions: {
        ...questions,
        [questionId]: { ...questions[questionId], ...patch },
      },
    });
  }

  clear(toolCallId: string): void {
    this.#delete(`ask-user:${toolCallId}`);
  }

  getPrompt(target: PromptDraftTarget): string {
    const entry = this.#entries.get(promptKey(target));
    return entry?.kind === "prompt" ? entry.text : "";
  }

  setPrompt(target: PromptDraftTarget, text: string): void {
    if (!text) this.clearPrompt(target);
    else
      this.#save(promptKey(target), {
        kind: "prompt",
        target: { ...target },
        text,
        updatedAt: Date.now(),
      });
  }

  clearPrompt(target: PromptDraftTarget): void {
    this.#delete(promptKey(target));
  }

  /** A completed send must not erase edits made while the request was in flight. */
  clearPromptIfUnchanged(target: PromptDraftTarget, sentText: string): void {
    if (this.getPrompt(target) === sentText) this.clearPrompt(target);
  }

  /** Durable replacement for the pending -> created composer-text handoff. */
  promotePendingPrompt(pendingId: string, conversationId: string): void {
    const key = `pending-conversation:${pendingId}`;
    const entry = this.#entries.get(key);
    this.#entries.delete(key);
    if (entry?.kind === "prompt") {
      const target = { kind: "conversation" as const, id: conversationId };
      this.#entries.set(promptKey(target), {
        ...entry,
        target,
        updatedAt: Date.now(),
      });
    }
    this.#persist();
  }

  /** Pending tab metadata is intentionally transient; recover its text on New Conversation. */
  restorablePendingPrompt(
    projectId: string,
    openPendingIds: Iterable<string>,
  ): Extract<PromptDraftTarget, { kind: "pending-conversation" }> | undefined {
    const open = new Set(openPendingIds);
    const newest = [...this.#entries.values()]
      .reverse()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const entry of newest) {
      if (
        entry.kind === "prompt" &&
        entry.target.kind === "pending-conversation" &&
        entry.target.projectId === projectId &&
        !open.has(entry.target.id)
      )
        return { ...entry.target };
    }
    return undefined;
  }

  #save(key: string, entry: Entry): void {
    // Refresh insertion order too, so timestamps tied within a millisecond prune oldest first.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#prune();
    this.#persist();
  }

  #delete(key: string): void {
    if (this.#entries.delete(key)) this.#persist();
  }

  #prune(): void {
    const oldest = [...this.#entries].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (const [key] of oldest.slice(
      0,
      Math.max(0, oldest.length - MAX_ENTRIES),
    ))
      this.#entries.delete(key);
  }

  #persist(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.#entries)),
      );
    } catch {
      // Keep reactive in-memory drafts when storage is blocked or full.
    }
  }
}

let shared: PersistentConversationDraftStore | undefined;
export function conversationDraftStore(): PersistentConversationDraftStore {
  if (!shared) {
    let storage: DraftStorage | undefined;
    try {
      storage = typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      // Browser privacy settings can deny even access to localStorage.
    }
    shared = new PersistentConversationDraftStore(storage);
  }
  return shared;
}

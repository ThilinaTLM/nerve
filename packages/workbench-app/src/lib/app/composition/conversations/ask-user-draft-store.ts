import { SvelteMap } from "svelte/reactivity";
import type {
  AskUserAnswerDraft,
  AskUserDraftStore,
} from "$lib/presentation/tools/tool-call/ask-user-state";

const STORAGE_KEY = "nerve:ask-user-drafts:v1";
const MAX_TOOL_CALLS = 50;
type Entry = {
  updatedAt: number;
  questions: Record<string, AskUserAnswerDraft>;
};
type DraftStorage = Pick<Storage, "getItem" | "setItem">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Synchronous persistence: reads, submit and pagehide never race a debounce. */
export class PersistentAskUserDraftStore implements AskUserDraftStore {
  readonly #entries = new SvelteMap<string, Entry>();

  constructor(private readonly storage?: DraftStorage) {
    try {
      const saved = record(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null"));
      for (const [id, raw] of Object.entries(saved)) {
        const entry = record(raw);
        if (
          typeof entry.updatedAt !== "number" ||
          !Number.isFinite(entry.updatedAt)
        )
          continue;
        const questions = Object.fromEntries(
          Object.entries(record(entry.questions)).flatMap(
            ([questionId, value]) => {
              const draft = record(value);
              const answer = {
                ...(typeof draft.option === "string"
                  ? { option: draft.option }
                  : {}),
                ...(typeof draft.text === "string" ? { text: draft.text } : {}),
              };
              return Object.keys(answer).length ? [[questionId, answer]] : [];
            },
          ),
        );
        if (Object.keys(questions).length)
          this.#entries.set(id, { updatedAt: entry.updatedAt, questions });
      }
      this.#prune();
    } catch {
      // Invalid or unavailable browser storage must not prevent answering.
    }
  }

  get(toolCallId: string): Record<string, AskUserAnswerDraft> {
    return this.#entries.get(toolCallId)?.questions ?? {};
  }

  update(
    toolCallId: string,
    questionId: string,
    patch: Partial<AskUserAnswerDraft>,
  ): void {
    const questions = this.get(toolCallId);
    this.#entries.set(toolCallId, {
      updatedAt: Date.now(),
      questions: {
        ...questions,
        [questionId]: { ...questions[questionId], ...patch },
      },
    });
    this.#prune();
    this.#persist();
  }

  clear(toolCallId: string): void {
    if (this.#entries.delete(toolCallId)) this.#persist();
  }

  #prune(): void {
    const oldest = [...this.#entries].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (const [id] of oldest.slice(
      0,
      Math.max(0, oldest.length - MAX_TOOL_CALLS),
    )) {
      this.#entries.delete(id);
    }
  }

  #persist(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.#entries)),
      );
    } catch {
      // Keep the reactive in-memory draft when storage is blocked or full.
    }
  }
}

let shared: PersistentAskUserDraftStore | undefined;
export function askUserDraftStore(): PersistentAskUserDraftStore {
  if (!shared) {
    let storage: DraftStorage | undefined;
    try {
      storage = typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      // Browser privacy settings can deny even access to localStorage.
    }
    shared = new PersistentAskUserDraftStore(storage);
  }
  return shared;
}

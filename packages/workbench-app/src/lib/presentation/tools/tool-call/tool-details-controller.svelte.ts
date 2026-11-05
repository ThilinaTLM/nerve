import type { ToolCallDetails } from "$lib/presentation/view-models/conversation";

/**
 * Full-record dialog state for one tool slot. Fetches the stored record on
 * demand and resets if recovery hands the slot a different durable id.
 */
export class ToolDetailsController {
  open = $state(false);
  loading = $state(false);
  error = $state<string | undefined>(undefined);
  details = $state<ToolCallDetails | undefined>(undefined);
  #previewUpdatedAt: string | undefined;
  #toolId: string | undefined;
  readonly #fetch: () => ((id: string) => Promise<ToolCallDetails>) | undefined;

  constructor(
    fetchToolCall: () => ((id: string) => Promise<ToolCallDetails>) | undefined,
  ) {
    this.#fetch = fetchToolCall;
  }

  /** A slot should normally receive one durable id; reset defensively. */
  syncToolId(id: string | undefined): void {
    if (id === this.#toolId) return;
    this.#toolId = id;
    this.open = false;
    this.loading = false;
    this.error = undefined;
    this.details = undefined;
    this.#previewUpdatedAt = undefined;
  }

  setOpen(open: boolean): void {
    this.open = open;
  }

  readonly show = async (toolCall: {
    id: string;
    updatedAt: string;
  }): Promise<void> => {
    this.open = true;
    if (this.details && this.#previewUpdatedAt === toolCall.updatedAt) return;
    this.loading = true;
    this.error = undefined;
    try {
      const fetchToolCall = this.#fetch();
      if (!fetchToolCall) throw new Error("Tool details are unavailable here.");
      this.details = await fetchToolCall(toolCall.id);
      this.#previewUpdatedAt = toolCall.updatedAt;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  };
}

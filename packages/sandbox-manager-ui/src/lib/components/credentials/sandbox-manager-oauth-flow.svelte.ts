import type { OAuthFlowInfo, RespondOAuthFlowRequest } from "@nervekit/shared";
import {
  cancelOAuthFlow,
  getOAuthFlow,
  respondOAuthFlow,
  startOAuthFlow,
} from "../../api/manager-client";

type OAuthStartInput = {
  provider: string;
  displayName?: string;
  defaultModel?: string;
};

type OAuthFlowControllerOptions = {
  onSucceeded?: (flow: OAuthFlowInfo) => void | Promise<void>;
};

export class SandboxManagerOAuthFlow {
  flow = $state<OAuthFlowInfo | undefined>(undefined);
  promptValue = $state("");
  busy = $state(false);
  error = $state<string | undefined>(undefined);

  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  #lastInput: OAuthStartInput | undefined;
  #succeededFlowId: string | undefined;
  readonly #onSucceeded?: (flow: OAuthFlowInfo) => void | Promise<void>;

  constructor(options: OAuthFlowControllerOptions = {}) {
    this.#onSucceeded = options.onSucceeded;
  }

  get active(): boolean {
    return Boolean(this.flow && !this.#isTerminal(this.flow));
  }

  #stopPolling(): void {
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = undefined;
    }
  }

  #isTerminal(flow: OAuthFlowInfo): boolean {
    return (
      flow.status === "succeeded" ||
      flow.status === "failed" ||
      flow.status === "cancelled"
    );
  }

  #handleFlowUpdate(flow: OAuthFlowInfo): void {
    this.flow = flow;
    if (flow.status === "succeeded" && this.#succeededFlowId !== flow.flowId) {
      this.#succeededFlowId = flow.flowId;
      void this.#onSucceeded?.(flow);
    }
  }

  #schedulePoll(): void {
    this.#stopPolling();
    this.#pollTimer = setTimeout(async () => {
      const current = this.flow;
      if (!current || this.#isTerminal(current)) return;
      try {
        this.#handleFlowUpdate(await getOAuthFlow(current.flowId));
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
      if (this.flow && !this.#isTerminal(this.flow)) this.#schedulePoll();
    }, 800);
  }

  reset(): void {
    this.#stopPolling();
    this.flow = undefined;
    this.promptValue = "";
    this.busy = false;
    this.error = undefined;
    this.#succeededFlowId = undefined;
  }

  async close(): Promise<void> {
    const current = this.flow;
    if (current && !this.#isTerminal(current)) {
      try {
        await cancelOAuthFlow(current.flowId);
      } catch {
        // Best effort; the server also expires abandoned flows by process lifetime.
      }
    }
    this.reset();
  }

  async begin(input: OAuthStartInput): Promise<void> {
    this.#lastInput = input;
    this.reset();
    this.busy = true;
    try {
      this.#handleFlowUpdate(await startOAuthFlow(input));
      if (this.flow && !this.#isTerminal(this.flow)) this.#schedulePoll();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  async restart(): Promise<void> {
    if (!this.#lastInput) return;
    await this.begin(this.#lastInput);
  }

  async respond(request: RespondOAuthFlowRequest): Promise<void> {
    const current = this.flow;
    if (!current?.promptId) return;
    this.busy = true;
    this.error = undefined;
    try {
      this.#handleFlowUpdate(await respondOAuthFlow(current.flowId, request));
      this.promptValue = "";
      if (this.flow && !this.#isTerminal(this.flow)) this.#schedulePoll();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  async submitPrompt(): Promise<void> {
    const current = this.flow;
    if (!current?.promptId) return;
    const value = this.promptValue;
    if (!current.allowEmpty && value.trim().length === 0) return;
    await this.respond({ promptId: current.promptId, value });
  }

  async selectOption(optionId: string): Promise<void> {
    const current = this.flow;
    if (!current?.promptId) return;
    await this.respond({ promptId: current.promptId, selectedId: optionId });
  }

  openExternal(url: string): void {
    window.open(url, "_blank", "noopener");
  }
}

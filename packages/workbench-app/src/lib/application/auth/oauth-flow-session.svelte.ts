import type { OAuthFlowInfo } from "$lib/api";
import { cancelOAuthFlow, getOAuthFlow, respondOAuthFlow } from "$lib/api";
import { deviceCodeSecondsRemaining } from "./device-code";
import { subscribeClock } from "$lib/presentation/clock/clock-ticker";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";

/**
 * The client of one server-side sign-in flow (a model provider's or an account's): follows its
 * state by polling, answers its prompts and cancels it. Subclasses decide what starts a flow and
 * what surrounds it (dialogs, steps).
 */
export class OAuthFlowSession {
  responseValue = $state("");
  busy = $state(false);
  error = $state<string | undefined>(undefined);
  flow = $state<OAuthFlowInfo | undefined>(undefined);
  now = $state(Date.now());
  copiedDeviceCode = $state(false);
  copiedLoginUrl = $state(false);

  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  #stopCountdown: (() => void) | undefined;
  #generation = 0;
  #pollFailures = 0;
  #starter: (() => Promise<OAuthFlowInfo>) | undefined;

  get deviceCodeSecondsRemaining(): number | undefined {
    const flow = this.flow;
    return flow?.state === "active" && flow.interaction.type === "device_code"
      ? deviceCodeSecondsRemaining(flow.interaction.expiresAt, this.now)
      : undefined;
  }

  protected errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  protected stopTimers(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#stopCountdown?.();
    this.#pollTimer = undefined;
    this.#stopCountdown = undefined;
  }

  #setFlow(flow: OAuthFlowInfo): void {
    const previousCode =
      this.flow?.state === "active" &&
      this.flow.interaction.type === "device_code"
        ? this.flow.interaction.userCode
        : undefined;
    this.flow = flow;
    const nextCode =
      flow.state === "active" && flow.interaction.type === "device_code"
        ? flow.interaction.userCode
        : undefined;
    if (nextCode !== previousCode) this.copiedDeviceCode = false;
    this.#stopCountdown?.();
    this.#stopCountdown = undefined;
    if (
      flow.state === "active" &&
      flow.interaction.type === "device_code" &&
      flow.interaction.expiresAt
    ) {
      this.now = Date.now();
      this.#stopCountdown = subscribeClock(
        1_000,
        (nowMs) => (this.now = nowMs),
      );
    }
  }

  #schedulePoll(generation = this.#generation): void {
    if (this.flow?.state !== "active" || generation !== this.#generation)
      return;
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    const delay = Math.min(1_000 * 2 ** this.#pollFailures, 5_000);
    this.#pollTimer = setTimeout(() => void this.#poll(generation), delay);
  }

  async #poll(generation: number): Promise<void> {
    this.#pollTimer = undefined;
    const current = this.flow;
    if (
      generation !== this.#generation ||
      !current ||
      current.state !== "active"
    )
      return;
    try {
      const next = await getOAuthFlow(current.flowId);
      if (generation !== this.#generation) return;
      this.error = undefined;
      this.#pollFailures = 0;
      this.#setFlow(next);
    } catch (err) {
      if (generation !== this.#generation) return;
      this.#pollFailures += 1;
      this.error = `Could not refresh login status: ${this.errorMessage(err)}`;
    }
    this.#schedulePoll(generation);
  }

  /** Forgets the flow and its timers; a poll or answer still in flight is ignored. */
  protected resetSession(): void {
    this.#generation += 1;
    this.stopTimers();
    this.responseValue = "";
    this.busy = false;
    this.error = undefined;
    this.flow = undefined;
    this.copiedDeviceCode = false;
    this.copiedLoginUrl = false;
    this.#pollFailures = 0;
  }

  /** Stops following the flow and cancels it on the server when it is still waiting. */
  protected async endSession(): Promise<void> {
    this.#generation += 1;
    this.stopTimers();
    await this.cancelActiveFlow();
  }

  protected async cancelActiveFlow(): Promise<void> {
    const active = this.flow;
    if (!active || active.state !== "active") return;
    try {
      await cancelOAuthFlow(active.flowId);
    } catch {
      // Closing must remain responsive even if cancellation cannot be delivered.
    }
  }

  /** Starts a flow with `start` and follows it; `restart` runs the same start again. */
  protected async begin(start: () => Promise<OAuthFlowInfo>): Promise<void> {
    this.#starter = start;
    this.#generation += 1;
    const generation = this.#generation;
    this.stopTimers();
    this.busy = true;
    this.error = undefined;
    this.flow = undefined;
    this.copiedLoginUrl = false;
    this.#pollFailures = 0;
    try {
      const flow = await start();
      if (generation !== this.#generation) return;
      this.#setFlow(flow);
      this.#schedulePoll(generation);
    } catch (err) {
      if (generation === this.#generation) this.error = this.errorMessage(err);
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  async restart(): Promise<void> {
    const start = this.#starter;
    if (!start) return;
    this.responseValue = "";
    this.error = undefined;
    await this.cancelActiveFlow();
    await this.begin(start);
  }

  async submitResponse(): Promise<void> {
    const current = this.flow;
    if (!current || current.state !== "active") return;
    const interaction = current.interaction;
    if (interaction.type !== "text_input" && interaction.type !== "browser")
      return;

    const manualEntry =
      interaction.type === "browser" ? interaction.manualEntry : undefined;
    const interactionId =
      interaction.type === "text_input"
        ? interaction.interactionId
        : manualEntry?.interactionId;
    if (!interactionId) return;
    const value = this.responseValue;
    const allowEmpty =
      interaction.type === "text_input" && interaction.allowEmpty;
    if (!allowEmpty && value.trim().length === 0) return;

    await this.#respond(
      interaction.type === "browser"
        ? { type: "manual_redirect", interactionId, value: value.trim() }
        : { type: "text", interactionId, value },
    );
  }

  async selectOption(optionId: string): Promise<void> {
    const current = this.flow;
    if (
      !current ||
      current.state !== "active" ||
      current.interaction.type !== "choice"
    )
      return;
    await this.#respond({
      type: "select",
      interactionId: current.interaction.interactionId,
      selectedId: optionId,
    });
  }

  async #respond(body: Parameters<typeof respondOAuthFlow>[1]): Promise<void> {
    const current = this.flow;
    if (!current || current.state !== "active") return;
    this.#generation += 1;
    const generation = this.#generation;
    this.stopTimers();
    this.busy = true;
    this.error = undefined;
    try {
      const flow = await respondOAuthFlow(current.flowId, body);
      if (generation !== this.#generation) return;
      this.responseValue = "";
      this.#setFlow(flow);
      this.#schedulePoll(generation);
    } catch (err) {
      if (generation === this.#generation) {
        this.error = this.errorMessage(err);
        this.#setFlow(current);
        this.#schedulePoll(generation);
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  async copyLoginUrl(): Promise<void> {
    const flow = this.flow;
    if (flow?.state !== "active" || flow.interaction.type !== "browser") return;
    try {
      await writeClipboardText(flow.interaction.authorizationUrl);
      this.copiedLoginUrl = true;
      this.error = undefined;
    } catch (err) {
      this.error = this.errorMessage(err);
    }
  }

  async copyDeviceCode(): Promise<void> {
    const flow = this.flow;
    if (flow?.state !== "active" || flow.interaction.type !== "device_code")
      return;
    try {
      await writeClipboardText(flow.interaction.userCode);
      this.copiedDeviceCode = true;
      this.error = undefined;
    } catch (err) {
      this.error = this.errorMessage(err);
    }
  }

  openExternal(url: string): void {
    window.open(url, "_blank", "noopener");
  }
}

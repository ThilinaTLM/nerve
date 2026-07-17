import {
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  replaceExecutableCommandBlocks,
  type RunPromptRecord,
} from "@nervekit/contracts";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { SandboxRunScope } from "./run-harness-session.js";

/** Narrow harness surface the prompt control needs to deliver queued prompts. */
export interface SandboxHarnessPromptPort {
  steer(
    text: string,
    options: { id: string; images?: RunPromptRecord["images"] },
  ): Promise<unknown>;
  followUp(
    text: string,
    options: { id: string; images?: RunPromptRecord["images"] },
  ): Promise<unknown>;
  removeQueuedMessage(promptId: string): Promise<boolean>;
}

/**
 * Owns steer/follow-up prompt flow for one run execution: pre-turn buffering
 * until the first `turn_start`, forwarding-promise tracking, queued-message
 * removal, and executable `!!!` command-block expansion at delivery time so
 * queued prompts get the same command semantics as run-starting prompts.
 */
export class SandboxPromptControl {
  private readonly pendingPrompts: Array<{
    behavior: "steer" | "follow-up";
    prompt: RunPromptRecord;
  }> = [];
  private readonly forwardingPrompts = new Map<string, Promise<void>>();
  private harnessReady = false;

  constructor(
    private readonly deps: {
      harness: () => SandboxHarnessPromptPort | undefined;
      toolRuntime?: SandboxToolRuntime;
      scope: SandboxRunScope;
      signal: AbortSignal;
    },
  ) {}

  /** Expands executable `!!!` command blocks by running them through bash. */
  async expandPrompt(prompt: string): Promise<string> {
    if (findExecutableCommandBlocks(prompt).length === 0) return prompt;
    const runtime = this.deps.toolRuntime;
    if (!runtime) return prompt;
    const replacements = [];
    for (const block of findExecutableCommandBlocks(prompt)) {
      const result = await runtime.execute(
        "bash",
        { command: block.command },
        { ...this.deps.scope, signal: this.deps.signal },
      );
      replacements.push({
        block,
        text: formatInlineCommandResultText({
          command: block.command,
          output: result.content || "(no output)",
          status: "completed",
          exitCode: result.exitCode,
        }),
      });
    }
    return replaceExecutableCommandBlocks(prompt, replacements);
  }

  async steer(prompt: RunPromptRecord): Promise<void> {
    if (!this.harnessReady) {
      this.pendingPrompts.push({ behavior: "steer", prompt });
      return;
    }
    await this.deps.harness()?.steer(await this.expandPrompt(prompt.text), {
      id: prompt.id,
      images: prompt.images,
    });
  }

  async followUp(prompt: RunPromptRecord): Promise<void> {
    if (!this.harnessReady) {
      this.pendingPrompts.push({ behavior: "follow-up", prompt });
      return;
    }
    await this.deps.harness()?.followUp(await this.expandPrompt(prompt.text), {
      id: prompt.id,
      images: prompt.images,
    });
  }

  /** Called on the first `turn_start`: flushes buffered pre-turn prompts. */
  async deliverPending(): Promise<void> {
    this.harnessReady = true;
    for (const queued of this.pendingPrompts.splice(0)) {
      const forwarding = this.forwardPrompt(queued).finally(() => {
        this.forwardingPrompts.delete(queued.prompt.id);
      });
      this.forwardingPrompts.set(queued.prompt.id, forwarding);
      await forwarding;
    }
  }

  async removeQueuedPrompt(promptId: string): Promise<boolean> {
    const pendingIndex = this.pendingPrompts.findIndex(
      (queued) => queued.prompt.id === promptId,
    );
    if (pendingIndex !== -1) {
      this.pendingPrompts.splice(pendingIndex, 1);
      return true;
    }
    const forwarding = this.forwardingPrompts.get(promptId);
    if (forwarding) await forwarding;
    return (await this.deps.harness()?.removeQueuedMessage(promptId)) ?? false;
  }

  private async forwardPrompt(queued: {
    behavior: "steer" | "follow-up";
    prompt: RunPromptRecord;
  }): Promise<void> {
    // Expand `!!!` command blocks at delivery time so queued prompts get the
    // same command semantics as run-starting prompts.
    const text = await this.expandPrompt(queued.prompt.text);
    if (queued.behavior === "steer") {
      await this.deps.harness()?.steer(text, {
        id: queued.prompt.id,
        images: queued.prompt.images,
      });
    } else {
      await this.deps.harness()?.followUp(text, {
        id: queued.prompt.id,
        images: queued.prompt.images,
      });
    }
  }
}

import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { isAgentToolSuspension } from "../../agent/suspension.js";
import type { AgentHarnessPhase } from "../lifecycle/events.js";
import { AgentHarnessError } from "../../errors.js";
import { normalizeHarnessError } from "../lifecycle/event-hub.js";
import type { AgentTool } from "../../agent/contracts/index.js";
import type { PromptTemplate, Skill } from "../configuration/options.js";
import type { AgentHarnessTurnState } from "../configuration/turn-state.js";

export interface HarnessTurnControllerOptions<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> {
  readonly getPhase: () => AgentHarnessPhase;
  readonly setPhase: (phase: AgentHarnessPhase) => void;
  readonly startRunPromise: () => () => void;
  readonly createTurnState: () => Promise<
    AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
  >;
  readonly executeTurn: (
    state: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] },
  ) => Promise<AssistantMessage>;
}

/** Owns foreground turn admission and lifecycle without owning harness state. */
export class HarnessTurnController<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> {
  constructor(
    private readonly options: HarnessTurnControllerOptions<
      TSkill,
      TPromptTemplate,
      TTool
    >,
  ) {}

  async runForegroundTurn(
    resolvePrompt: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) =>
      | { text: string; options?: { images?: ImageContent[] } }
      | Promise<{ text: string; options?: { images?: ImageContent[] } }>,
  ): Promise<AssistantMessage> {
    if (this.options.getPhase() !== "idle") {
      throw new AgentHarnessError("busy", "AgentHarness is busy");
    }
    this.options.setPhase("turn");
    const finishRunPromise = this.options.startRunPromise();
    try {
      const turnState = await this.options.createTurnState();
      const prompt = await resolvePrompt(turnState);
      return await this.options.executeTurn(
        turnState,
        prompt.text,
        prompt.options,
      );
    } catch (error) {
      this.options.setPhase("idle");
      if (isAgentToolSuspension(error)) throw error;
      throw normalizeHarnessError(error, "unknown");
    } finally {
      finishRunPromise();
    }
  }
}

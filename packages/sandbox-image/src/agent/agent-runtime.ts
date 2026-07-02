import type { SandboxConfigV1 } from "@nervekit/shared";
import { resolveModelSelection } from "../models/model-catalog.js";
export class SandboxAgentRuntime {
  constructor(private readonly config: SandboxConfigV1) {}
  describe(): Record<string, unknown> {
    return {
      mainModel: resolveModelSelection(
        this.config,
        this.config.agent.mainModel,
      ),
      mode: this.config.agent.mode ?? "normal",
    };
  }
}

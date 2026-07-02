import type { SandboxConfigV1 } from "@nervekit/shared";
import { resolveModelSelection } from "../models/model-catalog.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";

export type HarnessFactoryOptions = {
  workspaceDir: string;
  stateDir: string;
  toolRuntime?: SandboxToolRuntime;
};

export type SandboxHarnessDescriptor = {
  conversationPath: string;
  model: { provider: string; model?: string; limitations?: string[] };
  tools: string[];
};

export class HarnessFactory {
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: HarnessFactoryOptions,
  ) {}

  describe(conversationId: string, agentId: string): SandboxHarnessDescriptor {
    const model = resolveModelSelection(
      this.config,
      this.config.agent.mainModel,
    );
    return {
      conversationPath: `${this.options.stateDir}/conversations/${conversationId}/agents/${agentId}/conversation.jsonl`,
      model: {
        provider: model.provider,
        model: model.model,
        limitations: model.limitations.length ? model.limitations : undefined,
      },
      tools: this.options.toolRuntime
        ? this.options.toolRuntime
            .groups()
            .flatMap((group) => (group.active ? group.tools : []))
        : [],
    };
  }
}

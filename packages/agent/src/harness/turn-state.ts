import type {
  AgentMessage,
  AgentTool,
  AnyModel,
  ThinkingLevel,
} from "../types.js";
import type { ExecutionEnv } from "./env/types.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./options.js";
import type { Session } from "./session/session.js";
import { cloneStreamOptions } from "./stream-options.js";

export interface AgentHarnessTurnState<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  messages: AgentMessage[];
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  streamOptions: AgentHarnessStreamOptions;
  sessionId: string;
  systemPrompt: string;
  model: AnyModel;
  thinkingLevel: ThinkingLevel;
  tools: TTool[];
  activeTools: TTool[];
}

export async function createTurnState<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
>(options: {
  env: ExecutionEnv;
  session: Session;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  streamOptions: AgentHarnessStreamOptions;
  systemPrompt: AgentHarnessOptions<
    TSkill,
    TPromptTemplate,
    TTool
  >["systemPrompt"];
  model: AnyModel;
  thinkingLevel: ThinkingLevel;
  tools: Map<string, TTool>;
  activeToolNames: string[];
}): Promise<AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>> {
  const context = await options.session.buildContext();
  const sessionMetadata = await options.session.getMetadata();
  const tools = [...options.tools.values()];
  const activeTools = options.activeToolNames
    .map((name) => options.tools.get(name))
    .filter((tool): tool is TTool => tool !== undefined);
  let systemPrompt = "You are a helpful assistant.";
  if (typeof options.systemPrompt === "string") {
    systemPrompt = options.systemPrompt;
  } else if (options.systemPrompt) {
    systemPrompt = await options.systemPrompt({
      env: options.env,
      session: options.session,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      activeTools,
      resources: options.resources,
    });
  }
  return {
    messages: context.messages,
    resources: options.resources,
    streamOptions: cloneStreamOptions(options.streamOptions),
    sessionId: sessionMetadata.id,
    systemPrompt,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools,
    activeTools,
  };
}

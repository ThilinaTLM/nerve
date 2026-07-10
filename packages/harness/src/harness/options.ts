import type {
  ImageContent,
  SimpleStreamOptions,
  Transport,
} from "@earendil-works/pi-ai";
import type {
  AgentTool,
  AnyModel,
  QueueMode,
  ThinkingLevel,
} from "../types.js";
import type { Conversation } from "./conversation/conversation.js";
import type { ExecutionEnv } from "./env/types.js";

/**
 * Skill loaded from a `SKILL.md` file or provided by an application.
 *
 * `name`, `description`, and `filePath` are inserted into the system prompt in an XML-formatted block as suggested by agentskills.io.
 * Use {@link formatSkillsForSystemPrompt} to generate the spec-compatible system prompt block.
 */
export interface Skill {
  /** Stable skill name used for lookup and model-visible listings. */
  name: string;
  /** Short model-visible description of when to use the skill. */
  description: string;
  /** Full skill instructions. */
  content: string;
  /** Absolute path to the skill file. Used for model-visible location and resolving relative references. */
  filePath: string;
  /** Exclude this skill from model-visible skill lists while still allowing explicit application invocation. */
  disableModelInvocation?: boolean;
}

/** Prompt template that can be formatted into a prompt for explicit invocation. */
export interface PromptTemplate {
  /** Stable template name used for lookup or application command routing. */
  name: string;
  /** Optional description for command lists or autocomplete. */
  description?: string;
  /** Template content. Argument placeholders are formatted by `formatPromptTemplateInvocation`. */
  content: string;
}

/** Resources made available to explicit invocation methods and system-prompt callbacks. */
export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** Prompt templates available for explicit invocation. */
  promptTemplates?: TPromptTemplate[];
  /** Skills available to the model and explicit skill invocation. */
  skills?: TSkill[];
}

/** Curated provider request options owned by the harness and snapshotted per turn. */
export interface AgentHarnessStreamOptions {
  /** Preferred transport forwarded to the stream function. */
  transport?: Transport;
  /** Provider request timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum provider retry attempts. */
  maxRetries?: number;
  /** Optional cap for provider-requested retry delays. */
  maxRetryDelayMs?: number;
  /** Additional request headers merged with auth and lifecycle headers. */
  headers?: Record<string, string>;
  /** Provider metadata forwarded with requests. */
  metadata?: SimpleStreamOptions["metadata"];
  /** Provider cache retention hint. */
  cacheRetention?: SimpleStreamOptions["cacheRetention"];
  /** Provider-scoped environment values forwarded to pi-ai. */
  env?: SimpleStreamOptions["env"];
}

/** Per-request stream option patch returned by provider hooks. */
export interface AgentHarnessStreamOptionsPatch extends Omit<
  Partial<AgentHarnessStreamOptions>,
  "headers" | "metadata" | "env"
> {
  /** Header patch. `undefined` values delete keys; explicit `headers: undefined` clears all headers. */
  headers?: Record<string, string | undefined>;
  /** Metadata patch. `undefined` values delete keys; explicit `metadata: undefined` clears all metadata. */
  metadata?: Record<string, unknown | undefined>;
  /** Environment patch. `undefined` values delete keys; explicit `env: undefined` clears all env. */
  env?: Record<string, string | undefined>;
}

export interface AgentHarnessPromptOptions {
  images?: ImageContent[];
}

export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  env: ExecutionEnv;
  conversation: Conversation;
  tools?: TTool[];
  /**
   * Concrete resources available to explicit invocation methods and system-prompt callbacks.
   * Applications own loading/reloading resources and should call `setResources()` with new values.
   */
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  systemPrompt?:
    | string
    | ((context: {
        env: ExecutionEnv;
        conversation: Conversation;
        model: AnyModel;
        thinkingLevel: ThinkingLevel;
        activeTools: TTool[];
        resources: AgentHarnessResources<TSkill, TPromptTemplate>;
      }) => string | Promise<string>);
  getApiKeyAndHeaders?: (model: AnyModel) => Promise<
    | {
        apiKey: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
      }
    | undefined
  >;
  /** Curated stream/provider request options. Snapshotted at turn start. */
  streamOptions?: AgentHarnessStreamOptions;
  model: AnyModel;
  thinkingLevel?: ThinkingLevel;
  activeToolNames?: string[];
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}

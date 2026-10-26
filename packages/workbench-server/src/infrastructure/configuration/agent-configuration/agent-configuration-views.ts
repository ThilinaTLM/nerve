import type { z } from "zod";
import type { conversationAgentSummariesSchema } from "@nervekit/contracts/agent-configuration";
import type { ResolutionResult } from "@nervekit/contracts/agent-configuration";
import type {
  ConfigurationDiagnostic,
  AgentScope,
  AgentDocument,
} from "./document-adapters.js";
import type { ScopeGeneration } from "../scoped-store/scoped-document-store.js";

export type EffectiveAgentView =
  | {
      readonly status: "available";
      readonly conversationId: string;
      readonly role: "lead" | "child";
      readonly resolution: ResolutionResult;
      readonly diagnostics: readonly ConfigurationDiagnostic[];
      readonly sources: readonly ScopeGeneration<AgentScope, AgentDocument>[];
    }
  | {
      readonly status: "unavailable";
      readonly conversationId: string;
      readonly diagnostics: readonly ConfigurationDiagnostic[];
    };

export type Summary = z.infer<
  typeof conversationAgentSummariesSchema
>["entries"][string];

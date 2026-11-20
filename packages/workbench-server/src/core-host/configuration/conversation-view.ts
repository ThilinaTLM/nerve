import {
  allToolDescriptors,
  permissionMetadataForTool,
  scopedToolDefinitions,
  toolDefinitionByName,
} from "@nervekit/tools/catalog";
import type {
  ConfigurationAgentPort,
  ConfigurationDescription,
  ConfigurationExplanation,
  ConfigurationTool,
} from "@nervekit/tools/quick-script";
import type { ToolName } from "@nervekit/contracts/tools";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import {
  createExecutionAdmission,
  type AdmissionPolicySource,
} from "../permissions/execution-admission/admission.js";

/** What `configuration.describe`, `tools` and `explain` read for one conversation. */
export type ConversationViewOptions = {
  agentConfiguration: AgentConfigurationService;
  policy: AdmissionPolicySource;
  home: string;
  conversationId: string;
  projectDirectory: string;
  cwd: string;
  availableModels(): { provider: string; modelId: string }[];
};

export function createConversationView(
  options: ConversationViewOptions,
): Pick<ConfigurationAgentPort, "describe" | "tools" | "explain"> {
  const { conversationId, projectDirectory } = options;
  const names = (): string[] => [
    ...new Set([
      ...allToolDescriptors().map((tool) => tool.name),
      ...scopedToolDefinitions(projectDirectory).map((tool) => tool.name),
    ]),
  ];
  return {
    async describe(): Promise<ConfigurationDescription> {
      const base = {
        conversationId,
        projectDirectory,
        home: options.home,
        availableModels: options
          .availableModels()
          .map(({ provider, modelId }) => ({ provider, modelId })),
      };
      const view =
        await options.agentConfiguration.getEffective(conversationId);
      if (view.status !== "available")
        return {
          ...base,
          role: options.agentConfiguration.paths.locations.conversationOwner(
            conversationId,
          ).role,
          problem: `The agent configuration cannot be resolved (${view.diagnostics.map((issue) => `${issue.document}: ${issue.code}`).join("; ")}). Run configuration.check for both scopes.`,
        };
      const { settings, provenance } = view.resolution;
      const origin = (pointer: string) => {
        const found = provenance[pointer];
        return found
          ? {
              selectedBy: {
                source: found.source,
                ...(found.profile ? { profile: found.profile } : {}),
              },
            }
          : {};
      };
      const document = view.sources.find(
        (source) => source.scope.scope === "conversation",
      )?.document;
      const applied =
        document && "appliedProfile" in document
          ? document.appliedProfile
          : undefined;
      return {
        ...base,
        role: view.role,
        ...(settings.permissionRuleSetId
          ? {
              ruleSet: {
                id: settings.permissionRuleSetId,
                ...origin("/permissionRuleSetId"),
              },
            }
          : {}),
        ...(settings.model
          ? { model: { ...settings.model, ...origin("/model") } }
          : {}),
        ...(applied
          ? {
              profile: {
                name: applied.name,
                source: applied.source,
                requirements: applied.requirements,
              },
            }
          : {}),
      };
    },
    async tools() {
      return {
        tools: names()
          .map((name): ConfigurationTool => {
            const metadata = permissionMetadataForTool(
              name as ToolName,
              projectDirectory,
            );
            const extension = toolDefinitionByName(name, projectDirectory)
              ?.extension?.id;
            return {
              name,
              kind: metadata.kind,
              groups: [...metadata.groups],
              baseRisk: metadata.baseRisk,
              primaryArguments: [...metadata.primaryArguments],
              targetKinds: [...metadata.targetKinds],
              ...(extension ? { extension } : {}),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    async explain({ tool, args }): Promise<ConfigurationExplanation> {
      const known = names();
      if (!known.includes(tool)) {
        const near = known.find(
          (name) => name.toLowerCase() === tool.toLowerCase(),
        );
        throw new Error(
          near
            ? `No tool is named "${tool}"; names are case-sensitive. Use "${near}".`
            : `No tool is named "${tool}". Take the name from configuration.tools.list().`,
        );
      }
      const prepared = await createExecutionAdmission(options.policy)({
        toolCallId: "configuration-explain",
        conversationId,
        projectDir: projectDirectory,
        toolName: tool,
        origin: "model",
        args,
        cwd: options.cwd,
        target: {},
      });
      const result = prepared.check();
      if (result.kind === "blocked")
        return {
          decision: "blocked",
          reason: `The policy cannot be evaluated: ${result.request.diagnostics.map((issue) => `${issue.path} (${issue.code})`).join("; ")}. Run configuration.check for both scopes.`,
        };
      if (result.kind !== "policy")
        return {
          decision: "blocked",
          reason:
            "The configuration changed while it was read. Call explain again.",
        };
      const { supervision } = result;
      const authority = supervision.authority as { ruleSetId?: string };
      return {
        decision:
          supervision.decision === "approval" ? "prompt" : supervision.decision,
        ...(supervision.reason ? { reason: supervision.reason } : {}),
        ...(supervision.effectiveRisk
          ? { effectiveRisk: supervision.effectiveRisk }
          : {}),
        ...(supervision.matchedRule ? { rule: supervision.matchedRule } : {}),
        ...(authority?.ruleSetId ? { ruleSetId: authority.ruleSetId } : {}),
        ...(supervision.operations
          ? { operations: supervision.operations }
          : {}),
      };
    },
  };
}

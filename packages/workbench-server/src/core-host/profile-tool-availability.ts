import {
  capabilityToolNameSchema,
  type CapabilityConfiguration,
} from "@nervekit/contracts/capabilities";
import type { ModelSelection } from "@nervekit/contracts/models";
import {
  explicitValue,
  type AgentProfile,
} from "@nervekit/contracts/agent-profiles";
import { toolManifest } from "@nervekit/tools/catalog";

// Host/core handlers and local executors share this authoritative runtime catalog.
// Integration capabilities use their catalog group rather than individual tool names.
const installedTools = new Set(
  toolManifest.flatMap((tool) => [tool.name, tool.group]),
);

/** The same integration credential namespaces used by tool execution. */
export async function profileToolAvailability(options: {
  profile: AgentProfile;
  configuration: Pick<
    CapabilityConfiguration,
    "effective" | "availableTools" | "toolProfileOptions"
  >;
  credentialConfigured(key: string): Promise<boolean>;
  modelAvailable(selection: ModelSelection): Promise<void>;
  pythonAvailable?: boolean;
}): Promise<ReadonlyMap<string, string | undefined>> {
  const { profile, configuration } = options;
  const available = new Map<string, string | undefined>();
  for (const name of capabilityToolNameSchema.options) {
    if (name === "subagents") continue;
    let reason = installedTools.has(name) ? undefined : "Tool is not installed";
    if (!configuration.availableTools.includes(name))
      reason = "Required integration is not configured";
    if (name === "jira" || name === "confluence" || name === "web_search") {
      const id = configuration.effective.toolProfiles[name];
      const exists = configuration.toolProfileOptions[name].some(
        (profile) => profile.id === id,
      );
      const key = id
        ? `${name === "web_search" ? "tavily" : "atlassian"}:${id}`
        : undefined;
      if (!exists || !key || !(await options.credentialConfigured(key)))
        reason = "Select and configure an integration in Settings → Tools";
    }
    if (name === "explain_image") {
      const setting = profile.tools.explain_image;
      const payload = explicitValue(setting);
      const settings =
        payload?.settings ?? configuration.effective.toolSettings.explain_image;
      if (!settings.model)
        reason = "Choose an image explanation model in Settings → Tools";
      else {
        try {
          await options.modelAvailable(settings.model);
        } catch (error) {
          reason = `Image explanation model is unavailable (${error instanceof Error ? error.message : String(error)})`;
        }
      }
    }
    if (name === "python_exec" && options.pythonAvailable === false)
      reason = "Python runtime is not installed or configured";
    if (
      name === "generate_image" &&
      !(await options.credentialConfigured("openai-codex"))
    )
      reason = "Sign in to OpenAI Codex in Settings → Providers";
    available.set(name, reason);
  }
  return available;
}

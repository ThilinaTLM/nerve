import { isSubagentTool } from "@nervekit/contracts/tools";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";

/** Capability toggle that governs a tool, e.g. `subagent_prompt` -> `subagents`. */
export function capabilityForTool(toolName: string): string {
  return isSubagentTool(toolName) ? "subagents" : toolName;
}

/** Which direct-tool accounts the resolved extension settings select and the home still has. */
export type DirectToolAccounts = { search: boolean };

/**
 * Whether resolved settings enable a tool. Tools without a capability toggle
 * (and bash, which is always on) are enabled. The same rule decides which
 * tools are advertised and which model calls may execute.
 */
export function isToolEnabled(
  toolName: string,
  settings: Pick<LeadSettingsOverrides, "tools">,
  missingReferences: readonly string[] = [],
  accounts?: DirectToolAccounts,
): boolean {
  const name = capabilityForTool(toolName);
  if (
    missingReferences.some((pointer) => pointer.startsWith(`/tools/${name}/`))
  )
    return false;
  // web_search needs the account the Web extension selects.
  if (accounts && name === "web_search" && !accounts.search) return false;
  const parsed = capabilityToolNameSchema.safeParse(name);
  if (!parsed.success || parsed.data === "bash") return true;
  const entry = settings.tools?.[parsed.data];
  return Boolean(entry && "enabled" in entry && entry.enabled);
}

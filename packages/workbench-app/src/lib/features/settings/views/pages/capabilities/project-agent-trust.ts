import type { GetAgentConfigurationResult } from "@nervekit/contracts/agent-configuration";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** Trusts or revokes the exact project agent file bytes the user is looking at. */
export async function setProjectAgentTrust(
  document: GetAgentConfigurationResult | undefined,
  trusted: boolean,
): Promise<void> {
  if (
    document?.status !== "available" ||
    document.source.scope.scope !== "project"
  )
    throw new Error("Project configuration is unavailable. Reload it first.");
  const result = await requestWorkbench("agentConfiguration.trust", {
    target: { document: "agent", scope: document.source.scope },
    expectedDigest: document.source.digest,
    trusted,
  });
  if (result.status !== "saved")
    throw new Error(
      `The file changed since it was loaded (${result.status}). Reload and try again.`,
    );
}

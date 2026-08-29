import type { AvailableSkillsResponse } from "@nervekit/contracts/skills";
import { protocolRequest } from "@nervekit/protocol";

export async function listAvailableSkills(
  projectId?: string,
): Promise<AvailableSkillsResponse> {
  return (await protocolRequest("skill.list", { projectId })).result;
}

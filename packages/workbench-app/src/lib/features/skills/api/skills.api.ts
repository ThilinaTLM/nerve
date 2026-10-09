import type { AvailableSkillsResponse } from "@nervekit/contracts/skills";
import { requestConversation } from "$lib/application/startup/conversation-connection";

export async function listAvailableSkills(
  projectId?: string,
): Promise<AvailableSkillsResponse> {
  return requestConversation("skill.list", { projectId });
}

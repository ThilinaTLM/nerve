import type {
  agentPreferencesSchema,
  LeadSettingsOverrides,
  ProfileDefinition,
} from "@nervekit/contracts/agent-configuration";
import type { z } from "zod";
import type { PermissionRuleSet } from "@nervekit/contracts/permissions";
import { ruleSetActsWithoutAsking } from "./summarize-permissions.js";
import { code, codeList, line, type ReviewLine } from "./review-lines.js";

/** What a summarizer asks of the rest of the host. */
export type AgentReviewLookups = {
  /** A built-in or user rule set by id; absent when there is none. */
  ruleSet(id: string): Promise<PermissionRuleSet | undefined>;
  /** The rule set a profile asks for (required, else recommended), for a sub-agent that agent.json turns on. */
  profileRuleSetId(
    name: string,
    projectId?: string,
  ): Promise<string | undefined>;
};

type Settings = LeadSettingsOverrides;
type AgentPreferences = z.infer<typeof agentPreferencesSchema>;
const TOGGLED_TOOLS = [
  "python_exec",
  "web_search",
  "web_fetch",
  "quick_script",
] as const;

async function ruleSetLine(
  id: string,
  verb: string,
  lookups: AgentReviewLookups,
): Promise<ReviewLine> {
  const ruleSet = await lookups.ruleSet(id);
  if (!ruleSet)
    return line(`${verb} the rule set ${code(id)}, which does not exist`);
  return ruleSetActsWithoutAsking(ruleSet)
    ? line(
        `Runs without asking: ${verb.toLowerCase()} the ${code(id)} rule set`,
        true,
        "Runs without asking",
      )
    : line(
        `${verb} the ${code(id)} rule set`,
        false,
        "Sets the permission rules",
      );
}

/** Settings both profiles and `agent.json` can carry. */
async function settingsLines(
  settings: Settings | undefined,
  verbs: { ruleSet: string },
  lookups: AgentReviewLookups,
): Promise<ReviewLine[]> {
  if (!settings) return [];
  const lines: ReviewLine[] = [];
  if (settings.permissionRuleSetId)
    lines.push(
      await ruleSetLine(settings.permissionRuleSetId, verbs.ruleSet, lookups),
    );
  if (settings.tools?.subagents?.enabled === true)
    lines.push(
      line("Turns on delegation to sub-agents", true, "Turns on delegation"),
    );
  if (settings.model)
    lines.push(
      line(
        `Uses ${code(settings.model.modelId)}${
          settings.reasoningLevel ? `, thinking ${settings.reasoningLevel}` : ""
        }`,
        false,
        "Picks a model",
      ),
    );
  else if (settings.reasoningLevel)
    lines.push(
      line(
        `Sets thinking to ${settings.reasoningLevel}`,
        false,
        "Sets thinking",
      ),
    );
  const on = TOGGLED_TOOLS.filter(
    (tool) => settings.tools?.[tool]?.enabled === true,
  );
  if (on.length > 0)
    lines.push(line(`Turns on ${codeList(on)}`, false, "Turns on tools"));
  const skills = Object.values(settings.skills ?? {}).flatMap((group) =>
    group && typeof group === "object"
      ? Object.entries(group as Record<string, boolean>)
          .filter(([, enabled]) => enabled === true)
          .map(([name]) => name)
      : [],
  );
  if (skills.length > 0)
    lines.push(
      line(
        `Turns on the ${codeList(skills)} ${skills.length === 1 ? "skill" : "skills"}`,
        false,
        "Turns on skills",
      ),
    );
  const servers = Object.entries(settings.mcpServers?.servers ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (servers.length > 0)
    lines.push(
      line(
        `Turns on the MCP ${servers.length === 1 ? "server" : "servers"} ${codeList(servers)}`,
        false,
        "Turns on MCP servers",
      ),
    );
  return lines;
}

const instructionLines = (text: string) =>
  text.trim() === "" ? 0 : text.trim().split("\n").length;

/** The lines of an agent or sub-agent profile. */
export async function profileLines(
  profile: ProfileDefinition,
  scope: "user" | "project",
  lookups: AgentReviewLookups,
): Promise<ReviewLine[]> {
  const where = scope === "user" ? "every project" : "this project";
  const lines: ReviewLine[] = [
    ...(await settingsLines(
      profile.requirements,
      { ruleSet: "Requires" },
      lookups,
    )),
    ...(await settingsLines(
      profile.recommendations,
      { ruleSet: "Recommends" },
      lookups,
    )),
  ];
  const offered =
    profile.usableBy === "lead"
      ? `Selectable as the main agent in ${where}`
      : profile.usableBy === "subagent"
        ? `Offered to main agents in ${where} with delegation on`
        : `Selectable as the main agent and offered as a sub-agent in ${where}`;
  lines.push(
    profile.usableBy !== "lead" && profile.enabled === false
      ? line(
          `Not offered as a sub-agent until you turn it on in ${where}`,
          false,
          "Off until you turn it on",
        )
      : line(
          offered,
          false,
          profile.usableBy === "lead"
            ? "Main agent profile"
            : "Offered as a sub-agent",
        ),
  );
  const count = instructionLines(profile.instructions);
  if (count > 0)
    lines.push(
      line(
        `${count} ${count === 1 ? "line" : "lines"} of instructions`,
        false,
        "Has instructions",
      ),
    );
  return lines;
}

/** The lines of `agent.json`: the rule set and sub-agents it selects, and the defaults it sets. */
export async function agentPreferencesLines(
  preferences: AgentPreferences,
  lookups: AgentReviewLookups,
  projectId?: string,
): Promise<ReviewLine[]> {
  const overrides = preferences.overrides;
  const lines = await settingsLines(overrides, { ruleSet: "Uses" }, lookups);
  for (const [name, entry] of Object.entries(overrides.subagents ?? {})) {
    if ((entry as { enabled?: boolean }).enabled !== true) continue;
    const id = await lookups.profileRuleSetId(name, projectId);
    const ruleSet = id ? await lookups.ruleSet(id) : undefined;
    lines.push(
      ruleSet && ruleSetActsWithoutAsking(ruleSet)
        ? line(
            `Turns on the sub-agent ${code(name)}, which runs without asking`,
            true,
            "Turns on an autonomous agent",
          )
        : line(
            `Turns on the sub-agent ${code(name)}`,
            false,
            "Turns on a sub-agent",
          ),
    );
  }
  return lines;
}

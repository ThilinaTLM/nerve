import { basename, dirname } from "node:path";
import type {
  ConfigurationResource,
  Diagnostic,
} from "@nervekit/contracts/configuration";
import type { Skill } from "@nervekit/harness/resources";
import { discoverSkillFiles } from "../../resources/resource-loader.js";
import type { ProjectSkillTrust } from "../../resources/project-skill-trust.js";
import {
  approvalDiagnostic,
  projectOf,
  type ConfigurationResourceProvider,
  type ResourceContext,
} from "../resource-registry.js";

const APPROVAL = {
  kind: "trust",
  where: "Project settings → Skills",
} as const;

const shadowed = (by: string): Diagnostic => ({
  level: "warning",
  code: "skill-shadowed",
  message: `Another skill with this name is found first (${by}), so this one is never used. Rename it (folder and \`name\`) or remove one of the two.`,
});

/**
 * Skills of the user, the project and Nerve itself. Skills are read from disk for every agent
 * run, so reload equals check: both report what is on disk now.
 */
export function skillProvider(options: {
  storageHome: string;
  /** Skills that ship with Nerve (its own and the agent-browser ones). */
  builtin(): readonly Skill[];
  /** Project skills wait for the user's approval of their exact content. */
  trust: ProjectSkillTrust;
}): ConfigurationResourceProvider {
  async function all(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    const { project, user } = await discoverSkillFiles(
      context.projectDirectory,
      options.storageHome,
    );
    const group = context.scope === "user" ? user : project;
    // Precedence: project files, then user files, then built-ins; the first of a name wins.
    const taken = new Map<string, string>();
    if (context.scope === "user")
      for (const skill of project.skills)
        if (!taken.has(skill.name)) taken.set(skill.name, "in the project");
    const resource = (
      skill: Skill,
      scope: ConfigurationResource["scope"],
    ): ConfigurationResource => {
      const by = taken.get(skill.name);
      if (!by) taken.set(skill.name, skill.filePath);
      return {
        kind: "skill",
        id: skill.name,
        scope,
        ...(scope === "builtin" ? {} : { path: skill.filePath }),
        state: by ? "shadowed" : "active",
        ...(by
          ? {
              shadowedBy:
                by === "in the project"
                  ? ("project" as const)
                  : scope === "builtin"
                    ? ("user" as const)
                    : context.scope,
            }
          : {}),
        diagnostics: by && scope !== "builtin" ? [shadowed(by)] : [],
      };
    };
    const found = await Promise.all(
      group.skills.map(async (skill) => {
        const entry = resource(skill, context.scope);
        if (context.scope !== "project" || entry.state !== "active")
          return entry;
        const status = await options.trust.status(projectOf(context), skill);
        return status === "approved"
          ? entry
          : {
              ...entry,
              state: "needs_approval" as const,
              approval: APPROVAL,
              diagnostics: [
                {
                  ...approvalDiagnostic(APPROVAL),
                  ...(status === "changed"
                    ? {
                        message: `Its files changed since the user approved it, so it is not used until they approve it again in ${APPROVAL.where}. You cannot approve it; tell the user.`,
                      }
                    : {}),
                },
              ],
            };
      }),
    );
    // Loader diagnostics name a file; the folder is the skill.
    const byPath = new Map(found.map((entry) => [entry.path, entry]));
    for (const { path, ...diagnostic } of group.diagnostics) {
      let entry = byPath.get(path);
      if (!entry) {
        entry = {
          kind: "skill",
          id: basename(path) === "SKILL.md" ? basename(dirname(path)) : path,
          scope: context.scope,
          path,
          state: "invalid",
          diagnostics: [],
        };
        byPath.set(path, entry);
        found.push(entry);
      }
      entry.diagnostics.push(diagnostic);
    }
    return context.scope === "user"
      ? [
          ...found,
          ...options.builtin().map((skill) => resource(skill, "builtin")),
        ]
      : found;
  }
  const problems = async (context: ResourceContext) =>
    (await all(context)).filter((entry) => entry.diagnostics.length > 0);
  return { kinds: ["skill"], list: all, check: problems, reload: problems };
}

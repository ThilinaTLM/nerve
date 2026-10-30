import { legacySubagentCatalog } from "./frozen/subagent-catalog.js";
import { z } from "zod";
import {
  profileDefinitionSchema,
  type ProfileDefinition,
} from "@nervekit/contracts/agent-configuration";
import type { ProjectConfigurationType } from "../../project-migration/project-migration.js";
import { convertProfileDocument } from "./frozen/profile-document.js";
import { parseProfileMarkdown } from "./frozen/subagent-profile-format.js";
import { splitCatalogV037 } from "./frozen/released-format.js";
import { releasedContext, scopeLegacyInputs } from "./scoped-migrations.js";

// The project file version is independent of the shared home/profile DTO schemaVersion.
export type ProjectProfileDocument = ProfileDefinition & { version: 2 };
export const projectProfileSchema = {
  parse(value: unknown): ProjectProfileDocument {
    const { version, ...profile } = z
      .object({ version: z.literal(2) })
      .passthrough()
      .parse(value);
    return { ...profileDefinitionSchema.parse(profile), version };
  },
};
export function profileDocumentValue(value: unknown): ProfileDefinition {
  const profile: Partial<ProjectProfileDocument> = {
    ...projectProfileSchema.parse(value),
  };
  delete profile.version;
  return profileDefinitionSchema.parse(profile);
}
const cache = new Map<
  string,
  ProjectConfigurationType<ProjectProfileDocument | null>
>();
export function projectProfileConfiguration(
  name: string,
): ProjectConfigurationType<ProjectProfileDocument | null> {
  profileDefinitionSchema.shape.name.parse(name);
  const cached = cache.get(name);
  if (cached) return cached;
  const convert = (
    value: unknown,
    inputs: Readonly<Record<string, unknown>>,
  ) => {
    const old = legacySubagentCatalog(value);
    const scoped = Object.fromEntries(
      Object.entries(inputs).map(([path, input]) => [path.slice(7, -5), input]),
    );
    const result = splitCatalogV037(
      { schemaVersion: 1, profiles: { [name]: old.profiles[name] } },
      "project",
      releasedContext(scoped),
    ).profiles[name];
    if (!result)
      throw new Error("Legacy entry does not define a complete profile");
    return { ...result, version: 2 };
  };
  const skillInputs = (value: unknown) => {
    const entry = legacySubagentCatalog(value).profiles[name];
    const skills =
      entry && typeof entry === "object" && "skills" in entry
        ? entry.skills
        : undefined;
    return skills &&
      typeof skills === "object" &&
      !Array.isArray(skills) &&
      Object.keys(skills).length
      ? scopeLegacyInputs.filter((input) =>
          ["config/harness.json", "config/capabilities.json"].includes(
            input.path,
          ),
        )
      : [];
  };
  const descriptor: ProjectConfigurationType<ProjectProfileDocument | null> = {
    id: `agent-profile:${name}`,
    label: `Agent profile: ${name}`,
    resetDescription: `Remove the project profile ${name}; other profile entries will be preserved.`,
    fallbackDescription:
      "This entry is hidden and does not fall through to a lower-precedence profile.",
    path: `agent-profiles/${name}.json`,
    currentVersion: 2,
    version: { field: "version", absent: 1 },
    migrators: {
      1: (value) => ({
        ...(convertProfileDocument(value) as object),
        version: 2,
      }),
    },
    schema: {
      parse(value) {
        const parsed = projectProfileSchema.parse(value);
        if (parsed.name !== name)
          throw new Error("Profile name differs from filename");
        return parsed;
      },
    },
    legacySources: [
      {
        shared: true,
        path: "config/subagents.json",
        currentVersion: 2,
        version: { field: "version", absent: 1 },
        trustKind: "agent_profile",
        inputs: skillInputs,
        select(value) {
          const old = legacySubagentCatalog(value);
          if (!Object.hasOwn(old.profiles, name)) return false;
          const entry = old.profiles[name];
          return (
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            Object.keys(entry).some(
              (key) => !["enabled", "model", "thinking"].includes(key),
            )
          );
        },
        migrate: convert,
      },
      {
        path: `subagents/${name}.md`,
        currentVersion: 1,
        version: { field: "schemaVersion", absent: 1 },
        trustKind: "agent_profile",
        inputs: (value) => [
          ...skillInputs(value),
          {
            ...scopeLegacyInputs.find(
              (input) => input.path === "config/subagents.json",
            )!,
            select: (catalog) =>
              Object.hasOwn(legacySubagentCatalog(catalog).profiles, name),
          },
        ],
        decode: (bytes) => ({
          schemaVersion: 1,
          profiles: { [name]: parseProfileMarkdown(name, bytes) },
        }),
        migrate: (value, inputs) => {
          const old = legacySubagentCatalog(value);
          const scoped = Object.fromEntries(
            Object.entries(inputs).map(([path, input]) => [
              path.slice(7, -5),
              input,
            ]),
          );
          const split = splitCatalogV037(
            old,
            "project",
            releasedContext(scoped),
          );
          const definition = split.profiles[name];
          if (!definition) throw new Error("Missing Markdown profile");
          const preferences = inputs["config/subagents.json"]
            ? legacySubagentCatalog(inputs["config/subagents.json"]).profiles[
                name
              ]
            : undefined;
          const enabled =
            preferences &&
            typeof preferences === "object" &&
            "enabled" in preferences
              ? preferences.enabled
              : (old.profiles[name] as Record<string, unknown>).enabled;
          const launch = { ...split.launches[name] };
          delete launch.enabled;
          return {
            ...definition,
            enabled,
            recommendations: { ...definition.recommendations, ...launch },
            version: 2,
          };
        },
      },
    ],
    fallback: () => null,
    reset: () => null,
    trustKind: "agent_profile",
  };
  cache.set(name, descriptor);
  return descriptor;
}

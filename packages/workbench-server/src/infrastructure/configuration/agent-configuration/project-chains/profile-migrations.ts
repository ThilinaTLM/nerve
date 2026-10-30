import { z } from "zod";
import {
  profileDefinitionSchema,
  type ProfileDefinition,
} from "@nervekit/contracts/agent-configuration";
import type { ProjectConfigurationType } from "../../project-migration/project-migration.js";
import { convertProfileDocument } from "./frozen/profile-document.js";
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
    fallback: () => null,
    reset: () => null,
  };
  cache.set(name, descriptor);
  return descriptor;
}

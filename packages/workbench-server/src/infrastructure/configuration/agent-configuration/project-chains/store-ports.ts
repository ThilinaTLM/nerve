import {
  projectCapabilitiesConfiguration,
  projectIntegrations,
} from "./scoped-migrations.js";
import { atomicReplaceFile } from "../../../storage-bootstrap/file-mutations.js";
import type { atomicWriteJson } from "../../../storage-bootstrap/json.js";
import { resolve } from "node:path";
import type {
  ProjectConfigurationType,
  ProjectMigrationService,
} from "../../project-migration/project-migration.js";
import type {
  AgentConfigurationPaths,
  AgentScope,
} from "../document-adapters.js";
import type {
  SchemaDocument,
  ScopedDocumentOptions,
} from "../../scoped-store/scoped-document-store.js";

export function projectStorePorts<
  S extends AgentScope,
  D extends SchemaDocument,
>(
  migrations: ProjectMigrationService,
  paths: AgentConfigurationPaths,
  descriptor: (scope: S) => ProjectConfigurationType<unknown>,
): Pick<ScopedDocumentOptions<S, D>, "beforeLoad" | "persist" | "fromDisk"> {
  const context = (scope: S) => {
    if (scope.scope !== "project") throw new Error("Expected project scope");
    const directory = paths.locations.projectDirectory(scope.projectId);
    if (!directory) throw new Error("Project not found");
    return { projectId: scope.projectId, directory };
  };
  return {
    fromDisk(input, scope) {
      if (
        scope.scope !== "project" ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      )
        return input;
      const type = descriptor(scope);
      return { [type.version.field]: type.version.absent, ...input };
    },
    async beforeLoad(scope) {
      if (scope.scope !== "project") return;
      const type = descriptor(scope);
      migrations.register(type);
      const loaded = await migrations.load(context(scope), type);
      // The agent feature also loads these independent optional resources.
      // No chain depends on another chain or imports its values.
      if (type.id === "agent-settings")
        await Promise.all(
          (
            [
              projectCapabilitiesConfiguration,
              projectIntegrations,
            ] as ProjectConfigurationType<unknown>[]
          ).map(async (resource) => {
            migrations.register(resource);
            await migrations.load(context(scope), resource);
          }),
        );
      if (
        loaded.classification === "corrupted" &&
        loaded.sourceDigest !== undefined &&
        loaded.path === resolve(context(scope).directory, ".nerve", type.path)
      )
        return;
      if (
        loaded.classification === "corrupted" ||
        loaded.classification === "incompatible"
      )
        return [
          {
            code:
              loaded.classification === "incompatible"
                ? "future-version"
                : "invalid-value",
            pointer:
              loaded.classification === "incompatible"
                ? `/${type.version.field}`
                : "",
            message: `${type.label} are unavailable; ${type.resetDescription}`,
          },
        ];
    },
    async persist(scope, prepare) {
      if (scope.scope !== "project") return undefined;
      const type = descriptor(scope);
      migrations.register(type);
      return migrations.transact(context(scope), type, async () => {
        const candidate = type.schema.parse(await prepare());
        return {
          value: candidate,
          changed: true,
          result: `${JSON.stringify(candidate, null, 2)}\n`,
        };
      });
    },
  };
}

/** Keep host/test IO injection at the owning framework writer boundary. */
export function projectJsonWriter(
  write: typeof atomicReplaceFile,
): typeof atomicWriteJson {
  return async (file, value, mode) => {
    await write(
      file,
      (handle) => handle.writeFile(`${JSON.stringify(value, null, 2)}\n`),
      { mode, prepare: async () => undefined },
    );
  };
}

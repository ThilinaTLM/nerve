import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { Project } from "@nervekit/contracts/core";
import {
  launchDefinitionFileSchema,
  type LaunchDefinitionFile,
  type LaunchDefinitionCatalog,
} from "@nervekit/contracts/launch-definitions";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { launchDefinitionsConfiguration } from "./launch-definition-migrations.js";
import { ApplicationError } from "../../core/application-error.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function launchCatalogRevision(file: LaunchDefinitionFile): string {
  const sort = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          ...file,
          folders: sort(file.folders),
          definitions: sort(file.definitions),
        }),
      ),
    )
    .digest("hex");
}
export class LaunchDefinitionRepository {
  constructor(
    private readonly getProject: (id: string) => Project,
    private readonly migrations: ProjectMigrationService,
  ) {
    this.migrations.register(launchDefinitionsConfiguration);
  }
  async catalog(projectId: string): Promise<LaunchDefinitionCatalog> {
    const { value: file } = await this.load(projectId);
    return this.runtime(projectId, file);
  }
  async list(projectId: string) {
    return (await this.catalog(projectId)).definitions;
  }
  async transact<T>(
    projectId: string,
    expectedRevision: string,
    mutate: (file: LaunchDefinitionFile) => T,
  ): Promise<{ result: T; revision: string; changed: boolean }> {
    const context = this.context(projectId);
    context.directory = await realpath(context.directory);
    try {
      return await this.migrations.transact(
        context,
        launchDefinitionsConfiguration,
        (file) => {
          const previousRevision = launchCatalogRevision(file);
          if (expectedRevision !== previousRevision)
            throw new ApplicationError(
              409,
              "LAUNCH_CATALOG_CONFLICT",
              "Launch catalog changed; refresh before retrying.",
            );
          const result = mutate(file);
          const validated = launchDefinitionFileSchema.parse(file);
          const revision = launchCatalogRevision(validated);
          const changed = revision !== previousRevision;
          return { result: { result, revision, changed }, changed };
        },
      );
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "PROJECT_CONFIGURATION_BUSY"
      )
        throw new ApplicationError(409, "LAUNCH_CATALOG_BUSY", error.message, {
          retryable: true,
        });
      throw error;
    }
  }
  private runtime(
    projectId: string,
    file: LaunchDefinitionFile,
  ): LaunchDefinitionCatalog {
    return {
      projectId,
      revision: launchCatalogRevision(file),
      folders: file.folders,
      definitions: file.definitions.map((d) => ({
        ...d,
        scope: { kind: "project", projectId },
      })),
    };
  }
  health(projectId: string) {
    return this.migrations.health(projectId);
  }
  async resolve(
    projectId: string,
    action: "reload" | "reset",
    confirmed = false,
  ) {
    const context = this.context(projectId);
    if (action === "reset")
      await this.migrations.reset(
        context,
        launchDefinitionsConfiguration,
        confirmed,
      );
    else await this.migrations.reload(context, launchDefinitionsConfiguration);
    return this.catalog(projectId);
  }
  private context(projectId: string) {
    return { projectId, directory: this.getProject(projectId).directory };
  }
  private async load(projectId: string) {
    const directory = await realpath(this.getProject(projectId).directory);
    return this.migrations.load(
      { projectId, directory },
      launchDefinitionsConfiguration,
    );
  }
}

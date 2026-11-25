import type {
  ProjectConfigurationContext,
  ProjectMigrationService,
  ProjectConfigurationResult,
} from "../../project-migration/project-migration.js";
import {
  projectCapabilitiesConfiguration,
  type projectCapabilitiesSchema,
} from "./scoped-migrations.js";
import type { z } from "zod";
import type { TrustState } from "@nervekit/contracts/core";
import { diagnostic } from "../document-adapters.js";
import type { AgentScope, AgentDocument } from "../document-adapters.js";
import type { ScopeGeneration } from "../../scoped-store/scoped-document-store.js";
type Capabilities = z.infer<typeof projectCapabilitiesSchema>;
export class ProjectCapabilityLayer {
  private readonly entries = new Map<
    string,
    Promise<ProjectConfigurationResult<Capabilities>>
  >();
  constructor(private readonly migrations: ProjectMigrationService) {
    migrations.register(projectCapabilitiesConfiguration);
  }
  invalidate(projectId: string): void {
    for (const key of this.entries.keys())
      if (JSON.parse(key)[0] === projectId) this.entries.delete(key);
  }
  async capture(
    context: ProjectConfigurationContext,
    trustState: (path: string, digest: string) => TrustState,
  ) {
    const key = JSON.stringify([context.projectId, context.directory]);
    let pending = this.entries.get(key);
    if (!pending) {
      pending = this.migrations.load(context, projectCapabilitiesConfiguration);
      this.entries.set(key, pending);
    }
    const result = await pending;
    const state = result.sourceDigest
      ? trustState(result.path, result.sourceDigest)
      : "needs_review";
    const trusted = !!result.sourceDigest && state === "trusted";
    const usable =
      result.classification !== "corrupted" &&
      result.classification !== "incompatible";
    const source: ScopeGeneration<AgentScope, AgentDocument> = {
      scope: { scope: "project", projectId: context.projectId },
      path: result.path,
      generation: 0,
      revision: 0,
      digest: result.sourceDigest ?? "missing",
      document: {
        schemaVersion: 1,
        revision: 0,
        overrides: usable && trusted ? result.value.overrides : {},
      },
    };
    return {
      source,
      diagnostics:
        !usable || (result.sourceDigest && !trusted)
          ? [
              diagnostic(
                { scope: "project", projectId: context.projectId },
                "capabilities",
                result.path,
                result.classification === "incompatible"
                  ? "future-version"
                  : !usable
                    ? "invalid-value"
                    : state === "declined"
                      ? "project-declined"
                      : "project-needs-review",
              ),
            ]
          : [],
      current: () =>
        this.entries.get(key) === pending &&
        state ===
          (result.sourceDigest
            ? trustState(result.path, result.sourceDigest)
            : "needs_review"),
    };
  }
}

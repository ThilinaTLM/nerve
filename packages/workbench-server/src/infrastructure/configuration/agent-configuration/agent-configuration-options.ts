import type { TrustState } from "@nervekit/contracts/core";
import type { ScopedDocumentOptions } from "../scoped-store/scoped-document-store.js";
import type { ProjectMigrationService } from "../project-migration/project-migration.js";
import type {
  AgentDocument,
  AgentScope,
  ConfigurationLocations,
} from "./document-adapters.js";
import type { ResourceSnapshot } from "./profile-resources.js";

export interface AgentConfigurationServiceOptions extends ConfigurationLocations {
  builtins: Readonly<Record<string, string>>;
  projectMigration?: ProjectMigrationService;
  prepareUser?(): Promise<void>;
  retryUserMigration?(): void;
  prepareProject?(projectId: string): Promise<void>;
  retryProjectMigration?(projectId: string): void;
  /** The trust state of a project's `agent.json` bytes; absent: every project file is trusted. */
  projectAgentTrustState?(
    projectId: string,
    path: string,
    digest: string,
  ): TrustState;
  profileTrustState(
    projectId: string,
    path: string,
    digest: string,
  ): TrustState;
  prepareResources?(projectId: string): Promise<void>;
  captureResources(projectId?: string): ResourceSnapshot;
  publish?(
    domain: "agent" | "conversation-defaults" | "profile",
    scope: AgentScope,
  ): void;
  io?: Pick<
    ScopedDocumentOptions<AgentScope, AgentDocument>,
    "write" | "syncDirectory"
  >;
}

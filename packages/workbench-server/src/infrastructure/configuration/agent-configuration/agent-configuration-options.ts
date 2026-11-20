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
  isProjectAgentTrusted?(
    projectId: string,
    path: string,
    digest: string,
  ): boolean;
  isProfileTrusted(projectId: string, path: string, digest: string): boolean;
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

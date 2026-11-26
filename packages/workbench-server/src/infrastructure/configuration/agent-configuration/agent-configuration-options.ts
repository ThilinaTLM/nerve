import type { TrustState } from "@nervekit/contracts/core";
import type { ScopedDocumentOptions } from "../scoped-store/scoped-document-store.js";
import type { ProjectMigrationService } from "../project-migration/project-migration.js";
import type {
  AgentDocument,
  AgentScope,
  ConfigurationLocations,
} from "./document-adapters.js";
import type { ResourceSnapshot } from "./profile-resources.js";

/**
 * What Nerve's own writes of user files do to their approvals (docs/architecture/trust.md): a
 * trusted file stays trusted and a file Nerve creates is trusted. Project files carry theirs
 * through `projectMigration`.
 */
export interface UserTrustWrites {
  capture(
    kind: "agent_profile" | "capabilities",
    path: string,
    source: Buffer | undefined,
  ): Promise<((path: string, output: Buffer) => Promise<void>) | undefined>;
  revoke(kind: "agent_profile" | "capabilities", path: string): void;
}

export interface AgentConfigurationServiceOptions extends ConfigurationLocations {
  builtins: Readonly<Record<string, string>>;
  projectMigration?: ProjectMigrationService;
  prepareUser?(): Promise<void>;
  retryUserMigration?(): void;
  prepareProject?(projectId: string): Promise<void>;
  retryProjectMigration?(projectId: string): void;
  /** The trust state of an `agent.json` file's bytes (`projectId` null: the user's); absent: every file is trusted. */
  agentTrustState?(
    projectId: string | null,
    path: string,
    digest: string,
  ): TrustState;
  profileTrustState(
    projectId: string | null,
    path: string,
    digest: string,
  ): TrustState;
  userTrust?: UserTrustWrites;
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

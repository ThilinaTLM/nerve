import { homedir } from "node:os";
import type { TrustedResource, TrustDecision } from "@nervekit/contracts/core";
import type {
  McpGrantSnapshot,
  McpServerEntry as McpEntryInput,
  McpReview,
  McpServerRow,
  McpTarget,
  mcpSaveRequestSchema,
  mcpSaveResultSchema,
  mcpServersListResultSchema,
  mcpTestResultSchema,
} from "@nervekit/contracts/mcp";
import type { z } from "zod";
import {
  type CatalogEntry,
  type McpCatalog,
  type McpProject,
} from "./mcp-catalog.js";
import type { McpServerEntry as McpServerEntryConfig } from "./mcp-config.js";
import {
  mcpConfigPath,
  mcpEntrySecretNames,
  mcpGrantSnapshot,
  mcpReviewNotes,
  mcpSendsSentences,
  parseMcpConfig,
  projectMcpConfigPath,
} from "./mcp-config.js";
import {
  readMcpDocument,
  withEntry,
  withoutEntry,
  writeMcpDocument,
} from "./mcp-file.js";
import type { McpSecrets } from "./mcp-secrets.js";
import {
  mcpBlock,
  mcpBlockMessage,
  type McpEnablement,
} from "./mcp-enablement.js";
import type { McpServerHub } from "./mcp-server-hub.js";

type SaveRequest = z.infer<typeof mcpSaveRequestSchema>;
type SaveResult = z.infer<typeof mcpSaveResultSchema>;
type ListResult = z.infer<typeof mcpServersListResultSchema>;
type TestResult = z.infer<typeof mcpTestResultSchema>;

export type McpServiceOptions = {
  catalog: McpCatalog;
  secrets: McpSecrets;
  hub: McpServerHub;
  trust: {
    decide(input: TrustDecision): TrustedResource;
    find(
      kind: "mcp_server",
      projectId: string | null,
      resourceKey: string,
    ): TrustedResource | null;
    delete(id: string): void;
  };
  home: string;
  /** The directory of a project; absent: no such project. */
  projectDirectory(projectId: string): string | undefined;
  /** The resolved `mcpServers.servers` of the target's agent settings. */
  enablement(target: McpTarget): Promise<McpEnablement | undefined>;
  /** After any change: the agent settings' eligible names and the pages that show them are stale. */
  changed(target: McpTarget): void;
};

/**
 * Settings → MCP servers: list, save, remove, test, disconnect and review for one scope. Saving
 * records the user's approval of what it wrote; entries written any other way wait for review
 * (`trust.decide`). Nothing here is reachable from the agent.
 */
export class McpService {
  #saving: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: McpServiceOptions) {}

  #project(target: McpTarget): McpProject | undefined {
    if (target.scope === "user") return undefined;
    const projectDirectory = this.options.projectDirectory(target.projectId);
    if (!projectDirectory) throw new Error("Project not found");
    return { projectId: target.projectId, projectDirectory };
  }

  #path(target: McpTarget, project: McpProject | undefined) {
    return project
      ? projectMcpConfigPath(project.projectDirectory)
      : mcpConfigPath(this.options.home);
  }

  /** The directory a test or connection runs in: the project, or the user's home. */
  #directory(project: McpProject | undefined) {
    return project?.projectDirectory ?? homedir();
  }

  async list(target: McpTarget): Promise<ListResult> {
    const project = this.#project(target);
    const view = await this.options.catalog.load(project);
    const enablement = await this.options.enablement(target);
    const entries: {
      entry: CatalogEntry;
      inherited: boolean;
      shadowed: boolean;
    }[] =
      target.scope === "user"
        ? view.user.servers.map((server) => ({
            entry: this.options.catalog.entry("user", undefined, server),
            inherited: false,
            shadowed: false,
          }))
        : [
            ...(view.project?.servers ?? []).map((server) => ({
              entry: this.options.catalog.entry(
                "project",
                target.projectId,
                server,
              ),
              inherited: false,
              shadowed: false,
            })),
            ...view.user.servers.map((server) => ({
              entry: this.options.catalog.entry("user", undefined, server),
              inherited: true,
              shadowed: view.shadowed.some(
                (entry) => entry.name === server.name,
              ),
            })),
          ];
    const userNames = new Set(view.user.servers.map((server) => server.name));
    const servers: McpServerRow[] = [];
    for (const { entry, inherited, shadowed } of entries)
      servers.push(
        await this.#row(entry, {
          inherited,
          shadowed,
          replacesUser: entry.scope === "project" && userNames.has(entry.name),
          enablement,
          directory: this.#directory(project),
        }),
      );
    const file = target.scope === "user" ? view.user : view.project;
    return {
      servers,
      file: {
        path: file?.path ?? this.#path(target, project),
        exists: file?.exists ?? false,
        problems: file?.problems ?? [],
      },
    };
  }

  async #row(
    entry: CatalogEntry,
    context: {
      inherited: boolean;
      shadowed: boolean;
      replacesUser: boolean;
      enablement: McpEnablement | undefined;
      directory: string;
    },
  ): Promise<McpServerRow> {
    const block = mcpBlock(entry, context.enablement);
    const status =
      block === undefined || block === "disabled"
        ? await this.options.hub.status(entry, context.directory)
        : undefined;
    const state = block ?? status?.state ?? "idle";
    const error =
      block !== undefined
        ? mcpBlockMessage(entry, block, context.enablement, "user")
        : (status?.unset?.describe("user") ?? status?.error);
    return {
      name: entry.name,
      scope: entry.scope,
      inherited: context.inherited,
      replacesUser: context.replacesUser,
      shadowed: context.shadowed,
      transport: entry.server.kind,
      ...(entry.server.config.description
        ? { description: entry.server.config.description }
        : {}),
      entry: writtenEntry(entry.server.config),
      state,
      ...(error ? { error } : {}),
      review: entry.review,
      enabled: block !== "disabled",
      ...(status?.server ? { server: status.server } : {}),
      ...(status?.toolCount !== undefined
        ? { toolCount: status.toolCount }
        : {}),
      secrets: await Promise.all(
        mcpEntrySecretNames(entry.server.config).map(async (name) => ({
          name,
          set: await this.options.secrets.isSet(
            entry.scope,
            entry.projectId,
            name,
          ),
        })),
      ),
    };
  }

  /** Serialized: two saves of one file never interleave their read and write. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#saving.then(work, work);
    this.#saving = run.catch(() => undefined);
    return run;
  }

  save(request: SaveRequest): Promise<SaveResult> {
    return this.#serial(() => this.#save(request));
  }

  async #save(request: SaveRequest): Promise<SaveResult> {
    const { target, name, previousName } = request;
    const project = this.#project(target);
    const path = this.#path(target, project);
    const written = Object.fromEntries(
      Object.entries(request.entry).filter(([, value]) => value !== undefined),
    );
    const parsed = parseMcpConfig(
      path,
      JSON.stringify({ mcpServers: { [name]: written } }),
    );
    const server = parsed.servers[0];
    if (!server) return { status: "invalid", problems: parsed.problems };
    const referenced = new Set(mcpEntrySecretNames(server.config));
    const unreferenced = Object.keys(request.secrets ?? {}).filter(
      (secret) => !referenced.has(secret),
    );
    if (unreferenced.length > 0)
      return {
        status: "invalid",
        problems: unreferenced.map(
          (secret) =>
            `secret "${secret}" is not referenced by the entry (use \${secret:${secret}})`,
        ),
      };
    const { document, problems } = await readMcpDocument(path);
    if (problems.length > 0 && !request.replaceInvalid)
      return { status: "file_invalid", problems };
    const previous = problems.length > 0 ? {} : document.servers;
    const renamed = previousName !== undefined && previousName !== name;
    if (renamed && Object.hasOwn(previous, name))
      return {
        status: "invalid",
        problems: [
          `server "${name}": the name is already used by another entry`,
        ],
      };
    const servers = withEntry(
      previous,
      name,
      server.config,
      previousName && previousName !== name ? previousName : undefined,
    );
    await writeMcpDocument(path, {
      ...(problems.length > 0 || !document.schema
        ? {}
        : { schema: document.schema }),
      servers,
    });
    const scope = target.scope;
    const projectId = project?.projectId;
    for (const [secret, value] of Object.entries(request.secrets ?? {}))
      await this.options.secrets.set(scope, projectId, secret, value);
    // The user wrote this entry here: record the approval of exactly what was written.
    const entry = this.options.catalog.entry(scope, projectId, server);
    this.options.trust.decide({
      kind: "mcp_server",
      projectId: projectId ?? null,
      resourceKey: name,
      name: null,
      contentDigest: entry.digest,
      status: "trusted",
      grants: mcpGrantSnapshot(server),
    });
    if (renamed) this.#forgetApproval(scope, projectId, previousName);
    // Secrets the old entry used and the file no longer references are deleted.
    const old = parseMcpConfig(
      path,
      JSON.stringify({
        mcpServers: { [previousName ?? name]: previous[previousName ?? name] },
      }),
    ).servers[0];
    if (old)
      await this.#deleteUnusedSecrets(
        scope,
        projectId,
        mcpEntrySecretNames(old.config),
        servers,
      );
    await this.#changed(target);
    const row = (await this.list(target)).servers.find(
      (candidate) => candidate.name === name && !candidate.inherited,
    );
    if (!row) throw new Error("The saved entry is missing from its file");
    return { status: "saved", server: row };
  }

  remove(request: {
    target: McpTarget;
    name: string;
  }): Promise<{ removed: boolean }> {
    return this.#serial(() => this.#remove(request));
  }

  async #remove({ target, name }: { target: McpTarget; name: string }) {
    const project = this.#project(target);
    const path = this.#path(target, project);
    const { document, problems } = await readMcpDocument(path);
    if (problems.length > 0)
      throw new Error(
        `${path} is invalid and cannot be edited here: ${problems.join("; ")}`,
      );
    const existed = Object.hasOwn(document.servers, name);
    const servers = withoutEntry(document.servers, name);
    const entry = parseMcpConfig(
      path,
      JSON.stringify({ mcpServers: { [name]: document.servers[name] } }),
    ).servers[0];
    if (existed) await writeMcpDocument(path, { ...document, servers });
    this.#forgetApproval(target.scope, project?.projectId, name);
    if (entry)
      await this.#deleteUnusedSecrets(
        target.scope,
        project?.projectId,
        mcpEntrySecretNames(entry.config),
        servers,
      );
    await this.#changed(target);
    return { removed: existed };
  }

  #forgetApproval(
    scope: McpTarget["scope"],
    projectId: string | undefined,
    name: string,
  ) {
    const row = this.options.trust.find(
      "mcp_server",
      scope === "project" ? (projectId ?? null) : null,
      name,
    );
    if (row) this.options.trust.delete(row.id);
  }

  /** Deletes secrets only the removed entry used; others in the same file keep theirs. */
  async #deleteUnusedSecrets(
    scope: McpTarget["scope"],
    projectId: string | undefined,
    candidates: readonly string[],
    remaining: Record<string, unknown>,
  ) {
    const stillUsed = new Set(
      parseMcpConfig(
        "",
        JSON.stringify({ mcpServers: remaining }),
      ).servers.flatMap((server) => mcpEntrySecretNames(server.config)),
    );
    await this.options.secrets.delete(
      scope,
      projectId,
      candidates.filter((name) => !stillUsed.has(name)),
    );
  }

  /** The entry a target's page shows under this name: its own file's, else an inherited user entry. */
  async #find(target: McpTarget, name: string) {
    const project = this.#project(target);
    const view = await this.options.catalog.load(project);
    const own =
      target.scope === "project"
        ? view.project?.servers.find((server) => server.name === name)
        : view.user.servers.find((server) => server.name === name);
    if (own)
      return {
        entry: this.options.catalog.entry(
          target.scope,
          project?.projectId,
          own,
        ),
        project,
      };
    const inherited = view.user.servers.find((server) => server.name === name);
    return inherited
      ? {
          entry: this.options.catalog.entry("user", undefined, inherited),
          project,
        }
      : undefined;
  }

  async review(request: {
    target: McpTarget;
    name: string;
  }): Promise<McpReview | null> {
    const found = await this.#find(request.target, request.name);
    if (!found) return null;
    const grants = mcpGrantSnapshot(found.entry.server);
    return {
      name: found.entry.name,
      scope: found.entry.scope,
      status: found.entry.review,
      digest: found.entry.digest,
      grants,
      sends: mcpSendsSentences(grants),
      notes: mcpReviewNotes(grants),
    };
  }

  /**
   * A decision through `trust.decide` on an entry: the review is recomputed here, the digest must
   * be that of the entry as it is now, and the stored grants are the ones computed here, not the
   * caller's. Throws when the entry is gone or changed since the user looked.
   */
  async checkDecision(input: {
    projectId: string | null;
    resourceKey: string;
    contentDigest: string;
  }): Promise<McpGrantSnapshot> {
    const review = await this.review({
      target: input.projectId
        ? { scope: "project", projectId: input.projectId }
        : { scope: "user" },
      name: input.resourceKey,
    });
    if (!review || review.scope !== (input.projectId ? "project" : "user"))
      throw new Error(
        `There is no MCP server "${input.resourceKey}" to decide on.`,
      );
    if (review.digest !== input.contentDigest)
      throw new Error(
        `MCP server "${input.resourceKey}" changed since it was reviewed. Review it again.`,
      );
    return review.grants;
  }

  async test(request: {
    target: McpTarget;
    name: string;
  }): Promise<TestResult> {
    const found = await this.#find(request.target, request.name);
    if (!found)
      return {
        status: "refused",
        state: "not_found",
        reason: `No MCP server "${request.name}" in this scope.`,
      };
    if (found.entry.review !== "approved")
      return {
        status: "refused",
        state: found.entry.review,
        reason: mcpBlockMessage(
          found.entry,
          found.entry.review,
          undefined,
          "user",
        ),
      };
    const result = await this.options.hub.inspect(
      found.entry,
      this.#directory(found.project),
    );
    if (!result.ok) return { status: "failed", error: result.error };
    return {
      status: "ok",
      ...(result.server ? { server: result.server } : {}),
      ...(result.instructions ? { instructions: result.instructions } : {}),
      tools: result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      })),
      resources: result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      })),
    };
  }

  async disconnect(request: {
    target: McpTarget;
    name: string;
  }): Promise<{ disconnected: boolean }> {
    const found = await this.#find(request.target, request.name);
    if (!found) return { disconnected: false };
    const disconnected = await this.options.hub.disconnect(found.entry);
    if (disconnected) this.options.changed(request.target);
    return { disconnected };
  }

  /**
   * A decision through `trust.decide` or `trust.delete`, or any other change of what is approved:
   * connections of entries that changed or lost approval close.
   */
  async approvalChanged(target: McpTarget): Promise<void> {
    await this.#changed(target);
  }

  async #changed(target: McpTarget) {
    await this.options.hub.reconcile().catch(() => undefined);
    this.options.changed(target);
  }
}

/** The entry as the form edits it: `streamable-http` (accepted in files) is the `http` transport. */
function writtenEntry(config: McpServerEntryConfig["config"]): McpEntryInput {
  const { type, ...rest } = config;
  return {
    ...rest,
    ...(type === undefined
      ? {}
      : { type: type === "stdio" ? ("stdio" as const) : ("http" as const) }),
  };
}

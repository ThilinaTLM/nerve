import {
  projectAgentConfiguration,
  projectConversationDefaults,
} from "./project-chains/scoped-migrations.js";
import {
  projectProfileConfiguration,
  projectProfileSchema,
} from "./project-chains/profile-migrations.js";
import type { ProjectConfigurationType } from "../project-migration/project-migration.js";
import { withoutLegacyTransition } from "./document-adapters.js";
import {
  createLegacyRepair,
  legacyTargetPath,
} from "./scoped-legacy-repair.js";
import { readConfigurationDigest } from "./configuration-bytes.js";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  agentPreferencesSchema,
  childConversationAgentSchema,
  leadConversationAgentSchema,
  conversationDefaultsSchema,
  profileDefinitionSchema,
  appliedProfileSchema,
  type RepairPreviewRequest,
  type RepairApplyRequest,
  type RepairPreview,
  type ScopedConfigurationTarget,
} from "@nervekit/contracts/agent-configuration";
import { atomicReplaceFile } from "../../storage-bootstrap/file-mutations.js";
import {
  digestBytes,
  ScopeConflictError,
} from "../scoped-store/scoped-document-store.js";
import {
  synchronizeDirectory,
  type DirectoryDurability,
} from "../scoped-store/durable-write.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";

export function configurationTargetPath(
  service: AgentConfigurationService,
  target: ScopedConfigurationTarget,
): string {
  return target.document === "agent"
    ? target.legacyFile
      ? legacyTargetPath(service, { ...target, legacyFile: target.legacyFile })
      : service.paths.agent(target.scope)
    : target.document === "profile"
      ? service.paths.profile(target.scope, target.name)
      : service.paths.creation(target.scope);
}
const bytesFor = (candidate: unknown) =>
  `${JSON.stringify(candidate, null, 2)}\n`;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (same(before, after)) return [];
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  )
    return [prefix];
  const left = before as Record<string, unknown>,
    right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(
    (key) =>
      changedPaths(
        left[key],
        right[key],
        `${prefix}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      ),
  );
}
async function original(file: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function parseOriginal(bytes: Buffer | null): unknown {
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

export function createScopedRepair(service: AgentConfigurationService) {
  const legacy = createLegacyRepair(service);
  function projectTarget(target: ScopedConfigurationTarget) {
    if (target.scope.scope !== "project") return undefined;
    const directory = service.paths.locations.projectDirectory(
      target.scope.projectId,
    );
    if (!directory) throw new Error("Project not found");
    const type: ProjectConfigurationType<unknown> =
      target.document === "profile"
        ? projectProfileConfiguration(target.name)
        : target.document === "conversation-defaults"
          ? projectConversationDefaults
          : projectAgentConfiguration;
    service.projectMigration.register(type);
    return { context: { projectId: target.scope.projectId, directory }, type };
  }

  async function preview(input: RepairPreviewRequest): Promise<RepairPreview> {
    if (
      input.target.document === "agent" &&
      input.target.scope.scope !== "conversation"
    ) {
      await service.ensureLoaded(input.target.scope);
      const legacyFile =
        input.target.legacyFile ?? service.legacyRepairFile(input.target.scope);
      if (legacyFile)
        return legacy.preview({
          ...input,
          target: { ...input.target, legacyFile },
        });
    }
    const project = projectTarget(input.target);
    if (
      project &&
      (await service.projectMigration.load(project.context, project.type))
        .classification === "incompatible"
    )
      throw new Error("Incompatible project configuration is read-only");
    const file = configurationTargetPath(service, input.target);
    const bytes = await original(file);
    const old = parseOriginal(bytes);
    let candidate: unknown = input.replacement;
    if (input.target.document === "profile") {
      candidate =
        input.target.scope.scope === "project"
          ? projectProfileSchema.parse({
              ...(candidate as object),
              version:
                candidate &&
                typeof candidate === "object" &&
                "version" in candidate
                  ? candidate.version
                  : 2,
            })
          : profileDefinitionSchema.parse(candidate);
      if ((candidate as { name: string }).name !== input.target.name)
        throw new Error("Profile name differs from filename");
    } else {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        throw new Error("Expected replacement document");
      const revision =
        old &&
        typeof old === "object" &&
        "revision" in old &&
        Number.isSafeInteger(old.revision) &&
        Number(old.revision) >= 0
          ? Number(old.revision)
          : 0;
      candidate = { ...candidate, revision: revision + 1 };
      if (input.target.document === "conversation-defaults")
        candidate = conversationDefaultsSchema.parse(candidate);
      else if (input.target.scope.scope !== "conversation")
        candidate = agentPreferencesSchema.parse(candidate);
      else {
        const owner = service.paths.locations.conversationOwner(
          input.target.scope.conversationId,
        );
        const snapshot =
          old && typeof old === "object" && "appliedProfile" in old
            ? appliedProfileSchema.nullable().safeParse(old.appliedProfile)
            : undefined;
        if (input.targetProfile) {
          const lookup = await service.profiles.get(
            input.targetProfile.name,
            owner.projectId,
            owner.role,
          );
          if (
            lookup.status !== "available" ||
            lookup.digest !== input.targetProfile.digest
          )
            throw new ScopeConflictError();
          candidate = {
            ...(candidate as Record<string, unknown>),
            appliedProfile: {
              name: lookup.definition.name,
              source: lookup.source,
              sourceDigest: lookup.digest,
              instructions: lookup.definition.instructions,
              recommendations: lookup.definition.recommendations ?? {},
              requirements: lookup.definition.requirements ?? {},
            },
          };
        } else if (
          !snapshot?.success ||
          !same(
            (candidate as { appliedProfile?: unknown }).appliedProfile,
            snapshot.data,
          )
        )
          throw new Error(
            "Repair requires a valid explicit target profile or preservation of the original snapshot",
          );
        candidate = (
          owner.role === "child"
            ? childConversationAgentSchema
            : leadConversationAgentSchema
        ).parse(candidate);
        candidate = withoutLegacyTransition(candidate as object);
      }
    }
    const resolution =
      input.target.document === "agent"
        ? await service.repairResolution(input.target.scope, candidate)
        : undefined;
    return {
      target: input.target,
      sourceDigest: bytes ? digestBytes(bytes) : "missing",
      candidateDigest: digestBytes(bytesFor(candidate)),
      candidateVersion: 1,
      candidate,
      changedPaths: changedPaths(old, candidate),
      ...(resolution ? { resolution } : {}),
      ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
    };
  }
  async function apply(input: RepairApplyRequest) {
    if (input.target.document === "agent" && input.target.legacyFile)
      return legacy.apply({
        ...input,
        target: { ...input.target, legacyFile: input.target.legacyFile },
      });
    const file = configurationTargetPath(service, input.target);
    const directory = path.join(
      service.paths.locations.home,
      "quarantine",
      "settings",
    );
    const id = digestBytes(
      JSON.stringify([file, input.sourceDigest, input.candidateDigest]),
    );
    const backupPath =
      input.sourceDigest === "missing"
        ? null
        : path.join(
            directory,
            `${input.target.scope.scope}-${input.target.document}-${id}.original`,
          );
    const receiptPath = path.join(directory, `${id}.receipt.json`);
    let durability: DirectoryDurability = "synchronized";
    const sync = async (filePath: string) => {
      if ((await synchronizeDirectory(filePath)) === "unsupported")
        durability = "unsupported";
    };
    const reload = async () => {
      if (input.target.document === "agent")
        await service.reload(input.target.scope);
      else if (input.target.document === "profile")
        await service.profiles.reload(input.target.scope, input.target.name);
      else await service.reloadCreation(input.target.scope);
    };
    // A durable receipt plus matching candidate bytes proves a prior replacement.
    // Reconcile publication only; never rewrite or revalidate a changed catalog target.
    if ((await readConfigurationDigest(file)) === input.candidateDigest) {
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      if (
        receipt.path !== file ||
        receipt.sourceDigest !== input.sourceDigest ||
        receipt.candidateDigest !== input.candidateDigest ||
        receipt.candidateVersion !== input.candidateVersion ||
        !same(receipt.target, input.target)
      )
        throw new ScopeConflictError();
      await sync(receiptPath);
      if (backupPath) await sync(backupPath);
      await sync(file);
      await reload();
      if ((await readConfigurationDigest(file)) !== input.candidateDigest)
        throw new ScopeConflictError();
      return {
        status: "saved" as const,
        digest: input.candidateDigest,
        backupPath,
        receiptPath,
        durability,
      };
    }
    const targetGuard =
      input.targetProfile && input.target.scope.scope === "conversation"
        ? await service.captureDefaults(
            service.paths.locations.conversationOwner(
              input.target.scope.conversationId,
            ).projectId,
          )
        : undefined;
    const prepared = await preview({
      target: input.target,
      replacement: input.candidate,
      ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
    });
    if (
      prepared.sourceDigest !== input.sourceDigest ||
      prepared.candidateDigest !== input.candidateDigest ||
      prepared.candidateVersion !== input.candidateVersion
    )
      throw new ScopeConflictError();

    const project = projectTarget(input.target);
    if (project) {
      if ((await readConfigurationDigest(file)) !== input.sourceDigest)
        throw new ScopeConflictError();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (backupPath) {
        const bytes = await readFile(file);
        if (digestBytes(bytes) !== input.sourceDigest)
          throw new ScopeConflictError();
        await atomicReplaceFile(
          backupPath,
          (handle) => handle.writeFile(bytes),
          { mode: 0o600 },
        );
        await sync(backupPath);
      }
      await atomicReplaceFile(
        receiptPath,
        (handle) =>
          handle.writeFile(
            bytesFor({
              schemaVersion: 1,
              target: input.target,
              path: file,
              sourceDigest: input.sourceDigest,
              candidateDigest: input.candidateDigest,
              candidateVersion: input.candidateVersion,
              backupPath,
            }),
          ),
        { mode: 0o600 },
      );
      await sync(receiptPath);
      if (targetGuard && !targetGuard.isCurrent())
        throw new ScopeConflictError();
      await service.projectMigration.reset(
        project.context,
        project.type,
        true,
        { value: prepared.candidate, sourceDigest: input.sourceDigest },
      );
    } else
      await atomicReplaceFile(
        file,
        async (handle) => {
          await handle.writeFile(bytesFor(prepared.candidate));
        },
        {
          mode: 0o600,
          prepare: async () => {
            if ((await readConfigurationDigest(file)) !== input.sourceDigest)
              throw new ScopeConflictError();
            await mkdir(directory, { recursive: true, mode: 0o700 });
            if (backupPath) {
              const bytes = await readFile(file);
              if (digestBytes(bytes) !== input.sourceDigest)
                throw new ScopeConflictError();
              await atomicReplaceFile(
                backupPath,
                (handle) => handle.writeFile(bytes),
                { mode: 0o600 },
              );
              await sync(backupPath);
            }
            await atomicReplaceFile(
              receiptPath,
              (handle) =>
                handle.writeFile(
                  bytesFor({
                    schemaVersion: 1,
                    target: input.target,
                    path: file,
                    sourceDigest: input.sourceDigest,
                    candidateDigest: input.candidateDigest,
                    candidateVersion: input.candidateVersion,
                    backupPath,
                  }),
                ),
              { mode: 0o600 },
            );
            await sync(receiptPath);
            if ((await readConfigurationDigest(file)) !== input.sourceDigest)
              throw new ScopeConflictError();
            if (targetGuard && !targetGuard.isCurrent())
              throw new ScopeConflictError();
            return undefined;
          },
        },
      );
    await sync(file);
    await reload();
    if ((await readConfigurationDigest(file)) !== input.candidateDigest)
      throw new ScopeConflictError();
    return {
      status: "saved" as const,
      digest: input.candidateDigest,
      backupPath,
      receiptPath,
      durability,
    };
  }
  return { preview, apply };
}

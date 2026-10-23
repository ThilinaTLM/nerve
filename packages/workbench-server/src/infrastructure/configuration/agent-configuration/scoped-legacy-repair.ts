import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  agentPreferencesSchema,
  legacyConfigurationFileSchema,
  type ScopedConfigurationTarget,
  type RepairPreviewRequest,
  type RepairPreview,
  type RepairApplyRequest,
} from "@nervekit/contracts/agent-configuration";
import { withFileMutation } from "../../storage-bootstrap/file-mutations.js";
import {
  safePath,
  writeProtected,
} from "../../migrations/steps/0002-agent-profiles/files.js";
import {
  digestBytes,
  ScopeConflictError,
} from "../scoped-store/scoped-document-store.js";
import {
  synchronizeDirectory,
  type DirectoryDurability,
} from "../scoped-store/durable-write.js";
import { readConfigurationDigest } from "./configuration-bytes.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";

type LegacyTarget = Extract<
  ScopedConfigurationTarget,
  { document: "agent" }
> & { legacyFile: string };
export function legacyTargetPath(
  service: AgentConfigurationService,
  target: LegacyTarget,
): string {
  if (target.scope.scope === "conversation")
    throw new Error("Legacy repair is user/project only");
  return path.join(
    path.dirname(service.paths.agent(target.scope)),
    legacyConfigurationFileSchema.parse(target.legacyFile) + ".json",
  );
}
export function createLegacyRepair(service: AgentConfigurationService) {
  async function preview(
    input: RepairPreviewRequest & { target: LegacyTarget },
  ): Promise<RepairPreview> {
    // This is a reset of one blocked legacy contribution, not authoring a new
    // schema into that old filename. Manual fixes use Reload/Retry instead.
    const replacement =
      input.replacement === null
        ? null
        : agentPreferencesSchema.parse(input.replacement);
    if (replacement && Object.keys(replacement.overrides).length)
      throw new Error(
        "Reset requires defaults; manually fix the legacy file and Retry to preserve settings",
      );
    if (
      input.targetProfile ||
      service.legacyRepairFile(input.target.scope) !== input.target.legacyFile
    )
      throw new ScopeConflictError();
    const file = legacyTargetPath(service, input.target);
    safePath(file);
    const bytes = await readFile(file);
    return {
      target: input.target,
      sourceDigest: digestBytes(bytes),
      candidateDigest: "missing",
      candidateVersion: 0,
      candidate: null,
      changedPaths: [file],
    };
  }
  async function apply(input: RepairApplyRequest & { target: LegacyTarget }) {
    if (
      input.candidate !== null ||
      input.candidateDigest !== "missing" ||
      input.candidateVersion !== 0 ||
      input.targetProfile
    )
      throw new ScopeConflictError();
    const file = legacyTargetPath(service, input.target);
    const id = digestBytes(
      JSON.stringify([file, input.sourceDigest, "missing"]),
    );
    const directory = path.join(
      service.paths.locations.home,
      "quarantine/settings",
    );
    const backupPath = path.join(directory, `${id}.legacy.original`),
      receiptPath = path.join(directory, `${id}.legacy.receipt.json`);
    let durability: DirectoryDurability = "synchronized";
    const sync = async (filePath: string) => {
      if ((await synchronizeDirectory(filePath)) === "unsupported")
        durability = "unsupported";
    };
    const receipt = {
      schemaVersion: 1,
      path: file,
      target: input.target,
      sourceDigest: input.sourceDigest,
      candidateDigest: "missing",
      candidateVersion: 0,
      backupPath,
    };
    // Re-establish scoped health after restart before entering the source lock;
    // conversion itself may acquire that lock.
    await service.ensureLoaded(input.target.scope);
    await withFileMutation(file, async () => {
      for (const entry of [file, backupPath, receiptPath]) safePath(entry);
      const current = await readConfigurationDigest(file);
      if (current === "missing") {
        const saved = JSON.parse(await readFile(receiptPath, "utf8"));
        if (
          JSON.stringify(saved) !== JSON.stringify(receipt) ||
          digestBytes(await readFile(backupPath)) !== input.sourceDigest
        )
          throw new ScopeConflictError();
        await sync(backupPath);
        await sync(receiptPath);
        await sync(file);
        return;
      }
      if (current !== input.sourceDigest) throw new ScopeConflictError();
      await preview({ target: input.target, replacement: input.candidate });
      const bytes = await readFile(file);
      if (digestBytes(bytes) !== input.sourceDigest)
        throw new ScopeConflictError();
      writeProtected(backupPath, bytes);
      await sync(backupPath);
      writeProtected(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
      await sync(receiptPath);
      // Backup and receipt must both be durable before removing the authority.
      if ((await readConfigurationDigest(file)) !== input.sourceDigest)
        throw new ScopeConflictError();
      await unlink(file);
      await sync(file);
    });
    await service.reload(input.target.scope);
    if ((await readConfigurationDigest(file)) !== "missing")
      throw new ScopeConflictError();
    return {
      status: "saved" as const,
      digest: "missing",
      backupPath,
      receiptPath,
      durability,
    };
  }
  return { preview, apply };
}

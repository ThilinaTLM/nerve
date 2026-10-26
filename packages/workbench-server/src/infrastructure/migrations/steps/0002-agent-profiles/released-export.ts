import assert from "node:assert/strict";
import { z } from "zod";
import {
  agentPreferencesSchema,
  conversationDefaultsSchema,
  leadConversationAgentSchema,
  childConversationAgentSchema,
  profileDefinitionSchema,
} from "@nervekit/contracts/agent-configuration";
import {
  sha256,
  jsonBytes,
  type ReleasedConversation,
} from "./released-format.js";

export interface ExportIO {
  /** undefined means ENOENT only; other errors propagate. All bytes are UTF-8 JSON. */
  read(path: string): string | undefined;
  /** Protected, durable, atomic replacement under the storage/file mutation lock. */
  write(path: string, bytes: string): void;
  remove(path: string): void;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const target = z
  .object({
    bytes: z.string(),
    digest,
    kind: z.enum([
      "preferences",
      "creation",
      "lead",
      "child",
      "profile",
      "integrations",
      "metadata",
    ]),
  })
  .strict();
export const exportReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z.literal("0.37.0"),
    identity: z.string(),
    sources: z.record(
      z.string(),
      z.object({ digest, backup: z.string() }).strict(),
    ),
    targets: z.record(z.string(), target),
    rowDigest: digest.optional(),
    retire: z.array(z.string()),
    report: z.array(z.string()),
  })
  .strict();
export type ExportReceipt = z.infer<typeof exportReceiptSchema>;
export type ExportTarget = z.infer<typeof target>;
const validators = {
  preferences: agentPreferencesSchema,
  creation: conversationDefaultsSchema,
  lead: leadConversationAgentSchema,
  child: childConversationAgentSchema,
  profile: profileDefinitionSchema,
};
export function validateTarget(output: ExportTarget): void {
  assert.equal(
    sha256(output.bytes),
    output.digest,
    "Candidate digest mismatch",
  );
  const document: unknown = JSON.parse(output.bytes);
  if (output.kind in validators)
    validators[output.kind as keyof typeof validators].parse(document);
  else if (output.kind === "integrations")
    assert(
      (document as { version?: unknown }).version === 2,
      "Invalid integrations export",
    );
}
export const exportedTarget = (
  kind: ExportTarget["kind"],
  value: unknown,
): ExportTarget => {
  const bytes = jsonBytes(value);
  const output = { kind, bytes, digest: sha256(bytes) };
  validateTarget(output);
  return output;
};
/** Stable, source-bound export independent of SQLite's row property enumeration. */
export function releasedRowDigest(row: ReleasedConversation): string {
  return sha256(
    JSON.stringify([
      row.conversation_id,
      row.model,
      row.reasoning_level,
      row.permission_rule_set_id,
      row.mode,
      row.system_prompt,
      row.instructions,
      row.working_directory,
      row.parent_conversation_id ?? null,
      row.project_id ?? null,
    ]),
  );
}
export function prepareExport(
  io: ExportIO,
  input: {
    identity: string;
    backupDirectory: string;
    sources: readonly string[];
    targets: Record<string, ExportTarget>;
    rowDigest?: string;
    retire?: string[];
    report?: string[];
  },
): ExportReceipt {
  const sources: ExportReceipt["sources"] = {};
  for (const path of input.sources) {
    const bytes = io.read(path);
    assert(bytes !== undefined, `Missing export source: ${path}`);
    sources[path] = {
      digest: sha256(bytes),
      backup: `${input.backupDirectory}/${sha256(path)}.original`,
    };
  }
  for (const [path, output] of Object.entries(input.targets)) {
    validateTarget(output);
    assert(
      sources[path] || io.read(path) === undefined,
      `Migration target collision: ${path}`,
    );
  }
  return exportReceiptSchema.parse({
    schemaVersion: 1,
    release: "0.37.0",
    identity: input.identity,
    sources,
    targets: input.targets,
    rowDigest: input.rowDigest,
    retire: input.retire ?? [],
    report: input.report ?? [],
  });
}
/** Write backups BEFORE the durable plan, then candidates. Retry requires the exact
 * saved plan: matching bytes alone never prove ownership of a preexisting target. */
export function applyExport(
  io: ExportIO,
  receiptPath: string,
  proposed: ExportReceipt,
): void {
  const saved = io.read(receiptPath);
  const receipt = exportReceiptSchema.parse(
    saved === undefined ? proposed : JSON.parse(saved),
  );
  if (saved !== undefined)
    assert.deepEqual(receipt, proposed, "Changed migration plan");
  for (const [path, source] of Object.entries(receipt.sources)) {
    const bytes = io.read(path),
      backup = io.read(source.backup);
    if (backup !== undefined)
      assert.equal(sha256(backup), source.digest, "Changed original backup");
    const candidate = receipt.targets[path];
    assert(
      bytes !== undefined &&
        (sha256(bytes) === source.digest ||
          (saved !== undefined &&
            candidate &&
            sha256(bytes) === candidate.digest)),
      `Changed migration source: ${path}`,
    );
    if (backup === undefined) {
      assert.equal(
        sha256(bytes),
        source.digest,
        "Original missing before backup",
      );
      io.write(source.backup, bytes);
    }
  }
  // Recheck collisions before recording ownership. Include same-path conversions.
  for (const [path, output] of Object.entries(receipt.targets)) {
    validateTarget(output);
    const actual = io.read(path);
    assert(
      actual === undefined ||
        (receipt.sources[path] &&
          sha256(actual) === receipt.sources[path].digest) ||
        (saved !== undefined && sha256(actual) === output.digest),
      `Migration target collision or later edit: ${path}`,
    );
  }
  if (saved === undefined) io.write(receiptPath, jsonBytes(receipt));
  for (const [path, output] of Object.entries(receipt.targets)) {
    if (io.read(path) !== output.bytes) io.write(path, output.bytes);
    assert.equal(io.read(path), output.bytes, "Export readback mismatch");
  }
}
export function verifyExport(
  io: Pick<ExportIO, "read">,
  receipt: ExportReceipt,
  expectedRowDigest?: string,
  allowRetired = false,
): void {
  exportReceiptSchema.parse(receipt);
  assert.equal(
    receipt.rowDigest,
    expectedRowDigest,
    "Released database row changed since export",
  );
  for (const [path, source] of Object.entries(receipt.sources)) {
    const current = io.read(path);
    if (
      !(allowRetired && current === undefined && receipt.retire.includes(path))
    ) {
      assert(
        current !== undefined &&
          sha256(current) === (receipt.targets[path]?.digest ?? source.digest),
        `Source changed after export: ${path}`,
      );
    }
    const original = io.read(source.backup);
    assert(
      original !== undefined && sha256(original) === source.digest,
      "Missing or changed protected original",
    );
  }
  for (const [path, output] of Object.entries(receipt.targets)) {
    validateTarget(output);
    assert.equal(
      io.read(path),
      output.bytes,
      `Missing or changed export: ${path}`,
    );
  }
}
/** Called only after database COMMIT is durably verified, not during export. */
export function retireExportSources(
  io: ExportIO,
  receipt: ExportReceipt,
): void {
  verifyExport(io, receipt, receipt.rowDigest, true);
  for (const path of receipt.retire) {
    assert(
      !receipt.targets[path] && receipt.sources[path],
      "Invalid source retirement",
    );
    const bytes = io.read(path);
    if (bytes === undefined) continue;
    assert.equal(
      sha256(bytes),
      receipt.sources[path].digest,
      "Source changed before retirement",
    );
    io.remove(path);
  }
}
/** Rollback never clobbers later edits. The database snapshot is restored by the
 * migration framework only while the failed step still owns storage. */
export function preflightRollbackExport(
  io: ExportIO,
  receipt: ExportReceipt,
): void {
  // Preflight the entire batch before changing any path.
  for (const [path, output] of Object.entries(receipt.targets)) {
    const current = io.read(path);
    assert(
      current === undefined ||
        sha256(current) === output.digest ||
        (receipt.sources[path] &&
          sha256(current) === receipt.sources[path].digest),
      `Rollback conflicts with later edit: ${path}`,
    );
  }
  for (const [path, source] of Object.entries(receipt.sources)) {
    const backup = io.read(source.backup),
      current = io.read(path);
    assert(
      backup !== undefined && sha256(backup) === source.digest,
      "Rollback original unavailable",
    );
    assert(
      current === undefined ||
        sha256(current) === source.digest ||
        (receipt.targets[path] &&
          sha256(current) === receipt.targets[path].digest),
      `Rollback source conflicts with later edit: ${path}`,
    );
  }
}
export function rollbackExport(io: ExportIO, receipt: ExportReceipt): void {
  preflightRollbackExport(io, receipt);
  for (const path of Object.keys(receipt.targets))
    if (!receipt.sources[path]) io.remove(path);
  for (const [path, source] of Object.entries(receipt.sources))
    io.write(path, io.read(source.backup)!);
}

export interface OriginalTrust {
  id?: string;
  name?: string | null;
  createdAt?: string;
  updatedAt?: string;
  projectId?: string | null;
  path: string;
  kind: string;
  contentDigest: string;
  status: "trusted" | "rejected";
}
/** Old blanket rejection is NOT carried over: grant only from matching trusted
 * original bytes; untrusted original contributions must never be laundered. */
export function convertedTrust(
  originals: readonly OriginalTrust[],
  inputs: readonly {
    path: string;
    digest: string;
    kind?: string;
    projectId?: string;
  }[],
  targetPath: string,
  targetDigest: string,
  kind: "agent_profile" | "project_capabilities" | "project_permissions",
) {
  const trusted =
    inputs.length > 0 &&
    inputs.every((input) =>
      originals.some(
        (original) =>
          original.path === input.path &&
          (input.projectId === undefined ||
            input.projectId === original.projectId) &&
          original.kind ===
            (input.kind ??
              (kind === "agent_profile" ? "subagent_profile" : kind)) &&
          original.status === "trusted" &&
          [input.digest, `sha256:${input.digest}`].includes(
            original.contentDigest,
          ),
      ),
    );
  return {
    path: targetPath,
    projectId: inputs[0]?.projectId,
    sourceBindings: inputs.map((input) => ({
      ...input,
      kind:
        input.kind ?? (kind === "agent_profile" ? "subagent_profile" : kind),
    })),
    sourceIds: originals
      .filter((original) =>
        inputs.some(
          (input) =>
            input.path === original.path &&
            input.projectId === original.projectId &&
            original.kind ===
              (input.kind ??
                (kind === "agent_profile" ? "subagent_profile" : kind)),
        ),
      )
      .flatMap((original) => (original.id ? [original.id] : [])),
    kind,
    contentDigest: targetDigest,
    status: trusted ? ("trusted" as const) : ("rejected" as const),
    report: trusted
      ? `Re-granted project trust for converted bytes: ${targetPath}`
      : undefined,
  };
}

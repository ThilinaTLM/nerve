import { toolCallRecordSchema, type ToolCallRecord } from "@nervekit/contracts";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SerializedConversationState } from "../../../domains/conversations/conversation-state-materializer.js";
import { toToolCallTranscriptRecord } from "../../../domains/tools/tool-call-transcript-preview.js";
import { prepareToolResult } from "../../../domains/tools/tool-result-bounds.js";
import { hydrateToolCallResult } from "../../../domains/tools/tool-result-artifact.js";
import { ToolResultPayloadStore } from "../../../domains/tools/tool-result-payload-store.js";
import { decode, encode } from "../../canonical-store/payload-codecs.js";
import { atomicWriteJson, pathExists } from "../../storage/json.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const markerPath = "migrations/.tool-result-payload-files-v1";
const manifest =
  "0019-tool-result-payload-files|v1|Move truncated complete tool results to owner-scoped payload files";

export const migration0019: StorageMigration = {
  id: "0019-tool-result-payload-files",
  description: "Move truncated complete tool results to payload files",
  checksum: migrationChecksum(manifest),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup() {
    return {
      paths: [
        "state.sqlite",
        "state.sqlite-wal",
        "state.sqlite-shm",
        "conversations",
        "tmp/tool-results",
        "payloads",
        markerPath,
      ],
    };
  },
  async up(context) {
    const payloads = new ToolResultPayloadStore(context.paths.home);
    await payloads.initialize();
    const documents = context.withDatabase(
      (database) =>
        database
          .prepare(
            `SELECT scope_id, data FROM domain_documents
           WHERE namespace = 'conversation_state' AND document_id = 'state'
           ORDER BY scope_id`,
          )
          .all() as Array<{ scope_id: string; data: Uint8Array }>,
    );

    for (const document of documents) {
      const state = decode(document.data) as SerializedConversationState;
      const migrated: Array<[string, ToolCallRecord]> = [];
      for (const [toolCallId, value] of state.toolCalls) {
        const stored = toolCallRecordSchema.parse(value);
        let artifactRecovered = true;
        const hydrated = await hydrateToolCallResult(
          context.paths.home,
          stored,
        ).catch(() => {
          artifactRecovered = false;
          return toolCallRecordSchema.parse({
            ...stored,
            result: isLegacyArtifactMarker(stored.result)
              ? { content: "Legacy complete tool result is unavailable." }
              : stored.result,
          });
        });
        const recovered = await recoverLegacyCompleteResult(
          context.paths.home,
          hydrated,
        );
        if (!artifactRecovered) recovered.complete = false;
        const prepared =
          hydrated.result === undefined
            ? { result: undefined, resultPayload: undefined }
            : await prepareToolResult(recovered.result, {
                toolCallId,
                conversationId: hydrated.conversationId,
                payloads,
              });
        const resultPayload = prepared.resultPayload
          ? {
              ...prepared.resultPayload,
              completeness: recovered.complete
                ? ("complete" as const)
                : ("legacy_bounded" as const),
            }
          : !recovered.complete && prepared.result !== undefined
            ? await payloads.write(
                hydrated.conversationId,
                toolCallId,
                stripLegacyRecoveryMetadata(prepared.result),
                "legacy_bounded",
              )
            : undefined;
        const nextBase = toolCallRecordSchema.parse({
          ...hydrated,
          result: stripLegacyRecoveryMetadata(prepared.result),
          resultPayload,
          resultPreview: undefined,
        });
        const resultPreview =
          toToolCallTranscriptRecord(nextBase).resultPreview;
        migrated.push([
          toolCallId,
          toolCallRecordSchema.parse({ ...nextBase, resultPreview }),
        ]);
      }
      const nextState: SerializedConversationState = {
        ...state,
        toolCalls: migrated,
      };
      context.transaction((database) => {
        database
          .prepare(
            `UPDATE domain_documents
             SET data = ?, payload_version = 2, updated_at_ms = ?
             WHERE namespace = 'conversation_state'
               AND scope_id = ? AND document_id = 'state'`,
          )
          .run(encode(nextState), context.now().getTime(), document.scope_id);
        const updateRecord = database.prepare(
          `UPDATE conversation_records
           SET payload_version = 2, data = ?
           WHERE id = ? AND conversation_id = ? AND kind = 'tool_call'`,
        );
        for (const [toolCallId, toolCall] of migrated) {
          updateRecord.run(
            encode({ version: 2, toolCall }),
            toolCallId,
            document.scope_id,
          );
        }
      });
    }

    await verifyCanonicalPayloads(context, payloads);
    await rm(join(context.paths.home, "tmp", "tool-results"), {
      recursive: true,
      force: true,
    });
    await rm(join(context.paths.home, "conversations"), {
      recursive: true,
      force: true,
    });
    await atomicWriteJson(join(context.paths.home, markerPath), {
      version: 1,
      migratedAt: context.now().toISOString(),
    });
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Tool-result payload migration marker is missing.");
    }
    await verifyCanonicalPayloads(
      context,
      new ToolResultPayloadStore(context.paths.home),
    );
  },
};

async function recoverLegacyCompleteResult(
  home: string,
  toolCall: ToolCallRecord,
): Promise<{ result: unknown; complete: boolean }> {
  const rawPath = legacyRawResultPath(toolCall.result);
  if (!rawPath) return { result: toolCall.result, complete: true };
  const legacyRoot = resolve(home, "tmp", "tool-results");
  const candidate = resolve(rawPath);
  if (
    !isAbsolute(rawPath) ||
    (candidate !== legacyRoot && !candidate.startsWith(`${legacyRoot}${sep}`))
  ) {
    return { result: toolCall.result, complete: false };
  }
  try {
    return {
      result: JSON.parse(await readFile(candidate, "utf8")) as unknown,
      complete: true,
    };
  } catch {
    return { result: toolCall.result, complete: false };
  }
}

function isLegacyArtifactMarker(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return "__nerveToolResultArtifact" in result;
}

function legacyRawResultPath(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const details = (result as Record<string, unknown>).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>).rawResultPath;
  return typeof value === "string" ? value : undefined;
}

function stripLegacyRecoveryMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLegacyRecoveryMetadata);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === "rawResultPath" ||
      key === "fullOutputPath" ||
      key === "continuation"
    ) {
      continue;
    }
    if (key === "artifacts" && Array.isArray(nested)) {
      const retained = nested.filter((artifact) => {
        if (!artifact || typeof artifact !== "object") return true;
        const path = (artifact as Record<string, unknown>).path;
        return typeof path !== "string" || !isAbsolute(path);
      });
      if (retained.length > 0) output[key] = retained;
      continue;
    }
    output[key] = stripLegacyRecoveryMetadata(nested);
  }
  return output;
}

async function verifyCanonicalPayloads(
  context: Parameters<StorageMigration["up"]>[0],
  payloads: ToolResultPayloadStore,
): Promise<void> {
  const documents = context.withDatabase(
    (database) =>
      database
        .prepare(
          `SELECT scope_id, data FROM domain_documents
         WHERE namespace = 'conversation_state' AND document_id = 'state'`,
        )
        .all() as Array<{ scope_id: string; data: Uint8Array }>,
  );
  for (const document of documents) {
    const state = decode(document.data) as SerializedConversationState;
    for (const [toolCallId, value] of state.toolCalls) {
      const toolCall = toolCallRecordSchema.parse(value);
      if (
        toolCall.resultPayload &&
        (toolCall.resultPayload.conversationId !== document.scope_id ||
          toolCall.resultPayload.toolCallId !== toolCallId)
      ) {
        throw new Error(`Payload ownership mismatch for ${toolCallId}.`);
      }
      if (toolCall.resultPayload) await payloads.verify(toolCall.resultPayload);
      const encoded = JSON.stringify(toolCall);
      if (
        encoded.includes("__nerveToolResultArtifact") ||
        encoded.includes("rawResultPath") ||
        encoded.includes("fullOutputPath")
      ) {
        throw new Error(`Legacy payload metadata remains for ${toolCallId}.`);
      }
    }
  }
  // Keep this import used as a path-safety assertion for future layout changes.
  if (relative(context.paths.home, payloads.root).startsWith("..")) {
    throw new Error("Payload root escapes NERVE_HOME.");
  }
}

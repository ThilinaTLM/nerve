import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  Asset,
  ModelContent,
  ToolCall,
  ToolCallOutcome,
} from "@nervekit/contracts/core";
import type {
  ToolExecutionResultPayload,
  ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
import { toolArtifactClaimSchema } from "@nervekit/contracts/tools";
import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import { projectAgentResult } from "@nervekit/tools/result-projection";
import type { AssetStore } from "../assets/asset-store.js";

export async function prepareToolResult(
  assets: AssetStore,
  call: ToolCall,
  outcome: ToolCallOutcome,
  result: ToolExecutionResultPayload,
  definition?: ToolDefinition,
) {
  const base = `conversations/${call.conversationId}/tool-calls/${call.id}`;
  const full = JSON.stringify(result);
  const payload = await assets.write({
    conversationId: call.conversationId,
    toolCallId: call.id,
    category: "payload",
    logicalPath: `${base}/result.json`,
    content: full,
    mediaType: "application/json",
  });
  const artifactAssets: Asset[] = [];
  const directory = assets.path(`${base}/files`);
  const files = await collectFiles(directory);
  for (const file of files) {
    const logicalPath = `${base}/files/${relative(directory, file).split(sep).join("/")}`;
    artifactAssets.push(
      await assets.register({
        conversationId: call.conversationId,
        toolCallId: call.id,
        category: "report",
        logicalPath,
      }),
    );
  }
  const details = result.details as
    | { outputLimits?: { artifacts?: unknown[] } }
    | undefined;
  const claims = details?.outputLimits?.artifacts ?? [];
  const validatedArtifacts: ValidatedToolArtifact[] = [];
  for (const raw of claims) {
    const parsed = toolArtifactClaimSchema.safeParse(raw);
    if (!parsed.success) continue;
    const claim = parsed.data;
    let claimedPath: string | null;
    try {
      claimedPath = claim.path
        ? resolve(claim.path)
        : claim.logicalPath
          ? assets.path(claim.logicalPath)
          : null;
    } catch {
      continue;
    }
    const asset = artifactAssets.find(
      (item) => assets.path(item.logicalPath) === claimedPath,
    );
    if (!asset) continue;
    validatedArtifacts.push({
      version: 1,
      id: asset.id,
      role: claim.role,
      access: { kind: "agent_file", path: assets.path(asset.logicalPath) },
      availability: "available",
      format: claim.format,
      size: { bytes: asset.byteLength },
      label: claim.label,
      recommendedTools: claim.recommendedTools,
    });
  }
  const completePayload: ValidatedToolArtifact = {
    version: 1,
    id: payload.id,
    role: "overflow_recovery",
    access: { kind: "agent_file", path: assets.path(payload.logicalPath) },
    availability: "available",
    format: { kind: "json", mediaType: "application/json", encoding: "utf-8" },
    size: { bytes: payload.byteLength },
    label: "Complete tool result payload",
    recommendedTools: ["read", "grep"],
  };
  const projection = projectAgentResult(
    {
      toolName: call.toolName,
      args: call.arguments,
      result,
      status: outcome === "indeterminate" ? "failed" : outcome,
      validatedArtifacts,
      completePayload,
      ...(outcome === "denied"
        ? {
            denialSource: call.interaction?.resolution
              ? ("user" as const)
              : ("policy" as const),
          }
        : {}),
    },
    (definition ?? toolDefinitionByName(call.toolName))?.agentResult,
  );
  const modelContent: ModelContent =
    call.origin === "user"
      ? [
          {
            type: "text",
            text: `Ran \`${String(call.arguments.command ?? "")}\`\n`,
          },
          ...projection.blocks,
        ]
      : projection.blocks;
  return {
    result:
      Buffer.byteLength(full) > 256 * 1024
        ? {
            contentBlocks: projection.blocks,
            details: { payloadAssetId: payload.id },
          }
        : result,
    modelContent,
    assetIds: [payload.id, ...artifactAssets.map((asset) => asset.id)],
  };
}

async function collectFiles(directory: string): Promise<string[]> {
  const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Tool artifact directory must be a regular directory");
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Tool artifacts must not be symlinks");
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

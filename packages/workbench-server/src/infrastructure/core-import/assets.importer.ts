import { assetSchema, type Asset } from "@nervekit/contracts/core";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { EventMapping } from "./events.mapper.js";
import {
  iso,
  type Legacy,
  type LegacyReader,
  type LegacyRow,
} from "./legacy.reader.js";

export interface AssetOwner {
  conversationId: string;
  toolCallId: string | null;
  asyncBashId?: string;
}

function* walk(path: string): Generator<string> {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else if (entry.isFile()) yield child;
  }
}

export function collectAssets(
  reader: LegacyReader,
  mapping: EventMapping,
  oldConversationId: string,
  rootId: string,
  tools: Map<string, AssetOwner>,
  tasks: Legacy[],
): Asset[] {
  const assets = new Map<string, Asset>();
  const root = realpathSync(mapping.dataDir);
  const add = (
    logicalPath: string,
    owner: AssetOwner,
    row?: LegacyRow,
  ): void => {
    if (assets.has(logicalPath)) return;
    const path = resolve(root, logicalPath);
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) {
      mapping.report.skip("Unsafe asset path");
      return;
    }
    let stat;
    try {
      stat = lstatSync(path);
      const resolved = relative(root, realpathSync(path));
      if (
        !stat.isFile() ||
        resolved.startsWith("../") ||
        isAbsolute(resolved)
      ) {
        mapping.report.skip("Linked or non-file asset");
        return;
      }
    } catch {
      mapping.report.missingFiles++;
    }
    const extension = extname(logicalPath).toLowerCase();
    const category =
      row?.category === "task_log"
        ? "bash_output"
        : (row?.category ??
          (owner.asyncBashId
            ? "bash_output"
            : /\.(png|jpg|jpeg|webp|gif)$/.test(extension)
              ? "image"
              : logicalPath.endsWith("result.json")
                ? "payload"
                : "report"));
    const asset = assetSchema.parse({
      id: mapping.ids.get("asset", String(row?.id ?? logicalPath)),
      conversationId: owner.conversationId,
      eventId: null,
      toolCallId: owner.toolCallId,
      asyncBashId: owner.asyncBashId ?? null,
      category,
      logicalPath,
      digest: row?.digest ?? null,
      byteLength: stat?.size ?? row?.byte_length ?? 0,
      mediaType:
        row?.media_type ?? (extension === ".json" ? "application/json" : null),
      createdAt: iso(row?.created_at_ms ?? stat?.birthtimeMs),
    });
    assets.set(logicalPath, asset);
    if (owner.toolCallId)
      mapping.toolAssets.set(owner.toolCallId, [
        ...(mapping.toolAssets.get(owner.toolCallId) ?? []),
        asset.id,
      ]);
  };
  for (const row of reader.db
    .prepare("SELECT * FROM file_assets WHERE conversation_id = ?")
    .iterate(oldConversationId)) {
    const tool = row.tool_call_id
      ? tools.get(String(row.tool_call_id))
      : undefined;
    add(
      String(row.logical_path),
      tool ?? {
        conversationId: rootId,
        toolCallId: row.tool_call_id
          ? mapping.ids.get("tool", String(row.tool_call_id))
          : null,
      },
      row,
    );
  }
  const oldSegment = oldConversationId.replace(/^conv_/, "");
  for (const path of walk(
    join(root, "conversations", oldSegment, "tool-calls"),
  )) {
    mapping.report.diskFiles++;
    const logicalPath = relative(root, path).split("\\").join("/");
    const toolSegment = logicalPath.split("/")[3];
    const oldToolId = toolSegment.startsWith("tool_")
      ? toolSegment
      : `tool_${toolSegment}`;
    const owner = tools.get(oldToolId) ?? {
      conversationId: rootId,
      toolCallId: mapping.ids.get("tool", oldToolId),
    };
    add(logicalPath, owner);
  }
  for (const { row, data } of reader.records(oldConversationId, "tool_call")) {
    const call = data.toolCall;
    const owner = tools.get(String(row.id));
    if (owner && call?.resultPayload?.logicalPath)
      add(call.resultPayload.logicalPath, owner);
  }
  for (const task of tasks) {
    if (task.origin?.kind !== "agent_tool") continue;
    const owner = tools.get(task.origin.toolCallId);
    const bashOwner = {
      conversationId: owner?.conversationId ?? rootId,
      toolCallId: mapping.ids.get("tool", task.origin.toolCallId),
      asyncBashId: mapping.ids.get("bash", task.id),
    };
    for (const path of [
      task.stdoutPath,
      task.stderrPath,
      task.combinedPath,
      task.logsPath,
    ]) {
      if (typeof path === "string") add(path, bashOwner);
    }
  }
  return [...assets.values()];
}

export function insertAssets(mapping: EventMapping, assets: Asset[]): void {
  for (const asset of assets) {
    const eventId = asset.toolCallId
      ? (mapping.responseEvents.get(asset.toolCallId) ?? null)
      : null;
    mapping.storage.assets.insert({ ...asset, eventId });
  }
  mapping.report.trackedFiles += assets.length;
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { EventMapping } from "./events.mapper.js";
import type { Legacy } from "./legacy.reader.js";
import { buildUserProjection } from "./user-projection/tool-user-projection.js";

// Files have deterministic names and atomic writes; retries never read converted
// destination files as legacy input or overwrite a source payload before verify.
export function prepareImportedResult(
  mapping: EventMapping,
  conversationId: string,
  toolCallId: string,
  toolName: string,
  args: Legacy,
  result: Legacy,
  modelContent: Legacy[],
  sourceLogicalPath?: string,
): Legacy {
  if (sourceLogicalPath)
    assert(
      !isAbsolute(sourceLogicalPath) &&
        !sourceLogicalPath.split(/[\\/]/).includes(".."),
      "Unsafe source payload path",
    );
  const base = `conversations/${conversationId}/tool-calls/${toolCallId}`;
  function write(
    logicalPath: string,
    content: Buffer,
    category: string,
    mediaType: string,
    original?: Legacy,
  ): Legacy {
    const root = realpathSync(mapping.dataDir),
      path = resolve(root, logicalPath);
    const rel = relative(root, path);
    assert(!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
    mkdirSync(dirname(path), { recursive: true });
    const realParent = relative(root, realpathSync(dirname(path)));
    assert(
      !isAbsolute(realParent) &&
        realParent !== ".." &&
        !realParent.startsWith("../"),
    );
    if (existsSync(path))
      assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    const temp = `${path}.importing`;
    if (existsSync(temp)) {
      assert(lstatSync(temp).isFile() && !lstatSync(temp).isSymbolicLink());
    }
    writeFileSync(temp, content, { mode: 0o600 });
    renameSync(temp, path);
    const asset = {
      ...(original ?? {}),
      id: original?.id ?? mapping.ids.get("asset", logicalPath),
      conversationId,
      eventId: null,
      toolCallId,
      asyncBashId: null,
      category,
      logicalPath,
      digest: createHash("sha256").update(content).digest("hex"),
      byteLength: content.length,
      mediaType,
      createdAt: original?.createdAt ?? "1970-01-01T00:00:00.000Z",
    };
    if (original) Object.assign(original, asset);
    else mapping.generatedAssets.set(asset.id, asset);
    const ids = mapping.toolAssets.get(toolCallId) ?? [];
    if (!ids.includes(asset.id))
      mapping.toolAssets.set(toolCallId, [...ids, asset.id]);
    return asset;
  }
  function externalize(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(externalize);
    const object = value as Legacy;
    if (object.type === "image" && typeof object.data === "string") {
      assert(typeof object.mimeType === "string", "Image missing MIME type");
      const bytes = Buffer.from(object.data, "base64");
      const hash = createHash("sha256")
        .update(object.mimeType)
        .update(bytes)
        .digest("hex");
      const asset = write(
        `${base}/images/${hash}`,
        bytes,
        "image",
        object.mimeType,
      );
      return { type: "image", assetId: asset.id, mimeType: object.mimeType };
    }
    return Object.fromEntries(
      Object.entries(object).map(([key, child]) => [key, externalize(child)]),
    );
  }
  const agentProjection: Legacy[] = modelContent.map((block) => {
    assert(
      block.type === "text" || block.type === "image",
      "Unsupported model-facing block",
    );
    return externalize(block) as Legacy;
  });
  const complete = externalize(result) as Legacy;
  const modelImages = agentProjection.filter(
    (block: Legacy) => block.type === "image",
  );
  const referenced = new Set<string>();
  function imageReferences(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(imageReferences);
      return;
    }
    const object = value as Legacy;
    if (object.type === "image") referenced.add(object.assetId);
    Object.values(object).forEach(imageReferences);
  }
  imageReferences(complete);
  const missingImages = modelImages.filter(
    (block) => !referenced.has(block.assetId),
  );
  if (missingImages.length)
    complete.contentBlocks = [
      ...(complete.contentBlocks ?? []),
      ...missingImages,
    ];
  const logicalPath = `${base}/result.json`;
  assert(
    sourceLogicalPath !== logicalPath,
    "Legacy payload overlaps destination; refusing to overwrite source",
  );
  const original = sourceLogicalPath
    ? mapping.sourceAssets.get(sourceLogicalPath)
    : undefined;
  write(
    logicalPath,
    Buffer.from(JSON.stringify(complete)),
    "payload",
    "application/json",
    original,
  );
  if (sourceLogicalPath)
    mapping.report.relocatedPayloads[sourceLogicalPath] = logicalPath;
  const userProjection = buildUserProjection(toolName, args, complete);
  referenced.clear();
  imageReferences(userProjection);
  const previewImages = modelImages.filter(
    (block) => !referenced.has(block.assetId),
  );
  if (previewImages.length)
    userProjection.resultPreview = {
      preview: userProjection.resultPreview,
      images: previewImages,
    };
  return {
    agentProjection,
    userProjection,
    assetIds: mapping.toolAssets.get(toolCallId) ?? [],
  };
}

export function assertProjectedPayload(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertProjectedPayload(item);
    return;
  }
  const object = value as Legacy;
  assert(
    !(object.type === "image" && ("data" in object || "base64" in object)),
    "Inline base64 image in event payload",
  );
  assert(
    !(
      object.type === "image_url" &&
      String(object.image_url?.url ?? object.url).startsWith("data:")
    ),
    "Inline data URL image in event payload",
  );
  for (const nested of Object.values(object)) assertProjectedPayload(nested);
}

import {
  toolArtifactClaimSchema,
  validatedToolArtifactSchema,
  type ToolArtifactClaim,
  type ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";
import type { ToolResultPayloadStore } from "./tool-result-payload-store.js";

export class ToolResultArtifactValidator {
  constructor(
    private readonly home: string,
    private readonly payloads: ToolResultPayloadStore,
  ) {}

  async validateClaims(
    input: { conversationId: string; toolCallId: string },
    claims: readonly unknown[],
  ): Promise<ValidatedToolArtifact[]> {
    const output: ValidatedToolArtifact[] = [];
    for (const [index, value] of claims.slice(0, 100).entries()) {
      const parsed = toolArtifactClaimSchema.safeParse(value);
      if (!parsed.success) continue; // Legacy kind-only paths are intentionally untrusted.
      output.push(
        validatedToolArtifactSchema.parse(
          await this.validateClaim(input, parsed.data, index),
        ),
      );
    }
    return output;
  }

  private async validateClaim(
    input: { conversationId: string; toolCallId: string },
    claim: ToolArtifactClaim,
    index: number,
  ): Promise<ValidatedToolArtifact> {
    const id = claim.id ?? `artifact_${index + 1}`;
    const base = {
      version: 1 as const,
      id,
      role: claim.role,
      format: claim.format,
      size: {
        bytes: claim.bytes ?? 0,
        ...(claim.lines !== undefined ? { lines: claim.lines } : {}),
        ...(claim.items !== undefined ? { items: claim.items } : {}),
        ...(claim.itemKind ? { itemKind: claim.itemKind } : {}),
      },
      recommendedTools: claim.recommendedTools,
      label: claim.label,
    };

    if (claim.logicalPath && !claim.path) {
      return {
        ...base,
        access: { kind: "managed_reference", logicalPath: claim.logicalPath },
        availability: "unavailable",
        recommendedTools: [],
        unavailableReason: "validation_failed",
      };
    }

    const path = claim.path;
    if (!path || !isAbsolute(path) || !this.isAllowedPath(input, path)) {
      return unavailable(base, path, "unsafe_path");
    }
    const chain = await inspectPathChain(path, this.allowedRoot(input, path));
    if (chain === "missing") return unavailable(base, path, "missing");
    if (chain === "symlink") return unavailable(base, path, "symlink");
    if (chain === "not_regular") return unavailable(base, path, "not_regular");
    const info = await lstat(path).catch(() => undefined);
    if (!info) return unavailable(base, path, "missing");

    const mediaType = baseMediaType(claim.format.mediaType);
    if (!formatMatchesMedia(claim.format.kind, mediaType)) {
      return unavailable(base, path, "unsupported_format");
    }
    const text = [
      "markdown",
      "text",
      "json",
      "jsonl",
      "directory_manifest",
    ].includes(claim.format.kind);
    const image = claim.format.kind === "image";
    const tools = claim.recommendedTools.filter((tool) =>
      text
        ? tool === "read" || tool === "grep"
        : image
          ? tool === "read" || tool === "explain_image"
          : false,
    );
    if (!text && !image) {
      return {
        ...base,
        access: { kind: "metadata_only", location: path },
        availability: "available",
        size: { ...base.size, bytes: info.size },
        recommendedTools: [],
      };
    }
    if (tools.length !== claim.recommendedTools.length) {
      return unavailable(base, path, "unsupported_format");
    }
    if (image && !(await hasImageSignature(path, mediaType))) {
      return unavailable(base, path, "unsupported_format");
    }
    return {
      ...base,
      access: { kind: "agent_file", path: resolve(path) },
      availability: "available",
      size: { ...base.size, bytes: info.size },
      recommendedTools: tools,
    };
  }

  private isAllowedPath(
    input: { conversationId: string; toolCallId: string },
    path: string,
  ): boolean {
    return this.roots(input).some((root) => within(root, path));
  }

  private allowedRoot(
    input: { conversationId: string; toolCallId: string },
    path: string,
  ): string {
    return this.roots(input).find((root) => within(root, path)) ?? this.home;
  }

  private roots(input: {
    conversationId: string;
    toolCallId: string;
  }): string[] {
    const paths = storagePaths(this.home);
    return [
      this.payloads.filesPath(input.conversationId, input.toolCallId),
      paths.reportsPath,
      paths.tasksPath,
    ].map((root) => resolve(root));
  }
}

function unavailable(
  base: Omit<ValidatedToolArtifact, "access" | "availability">,
  path: string | undefined,
  reason: NonNullable<ValidatedToolArtifact["unavailableReason"]>,
): ValidatedToolArtifact {
  return {
    ...base,
    access: { kind: "metadata_only", ...(path ? { location: path } : {}) },
    availability: "unavailable",
    recommendedTools: [],
    unavailableReason: reason,
  };
}

async function inspectPathChain(
  path: string,
  root: string,
): Promise<"ok" | "missing" | "symlink" | "not_regular"> {
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) return "not_regular";
  let cursor = root;
  const rootInfo = await lstat(root).catch(() => undefined);
  if (rootInfo?.isSymbolicLink()) return "symlink";
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    const info = await lstat(cursor).catch(() => undefined);
    if (!info) return "missing";
    if (info.isSymbolicLink()) return "symlink";
    if (cursor !== resolve(path) && !info.isDirectory()) return "not_regular";
    if (cursor === resolve(path) && !info.isFile()) return "not_regular";
  }
  return "ok";
}

function baseMediaType(mediaType: string): string {
  return mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function formatMatchesMedia(
  kind: ToolArtifactClaim["format"]["kind"],
  media: string,
): boolean {
  if (kind === "image")
    return [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ].includes(media);
  if (kind === "json" || kind === "directory_manifest")
    return media === "application/json";
  if (kind === "jsonl")
    return media === "application/x-ndjson" || media === "application/jsonl";
  if (kind === "markdown")
    return media === "text/markdown" || media === "text/plain";
  if (kind === "text")
    return (
      media.startsWith("text/") ||
      media.includes("xml") ||
      media.includes("javascript")
    );
  return kind === "binary";
}

async function hasImageSignature(
  path: string,
  mediaType: string,
): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
    const head = buffer.subarray(0, bytesRead);
    if (mediaType === "image/png") {
      return head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mediaType === "image/jpeg")
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (mediaType === "image/gif") {
      const signature = head.subarray(0, 6).toString("ascii");
      return signature === "GIF87a" || signature === "GIF89a";
    }
    if (mediaType === "image/webp") {
      return (
        head.subarray(0, 4).toString("ascii") === "RIFF" &&
        head.subarray(8, 12).toString("ascii") === "WEBP"
      );
    }
    if (mediaType === "image/svg+xml") {
      return /<svg(?:\s|>)/i.test(head.toString("utf8").replace(/^\uFEFF/, ""));
    }
    return false;
  } finally {
    await file.close();
  }
}

function within(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}

import { readFile, stat } from "node:fs/promises";
import type {
  VisionExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { buildProcessTextResult } from "../process/process-result.js";
import { detectSupportedImageMimeType } from "../filesystem/read.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveReadPath,
} from "../filesystem/path.js";

export const EXPLAIN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function optionalPrompt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("prompt must be a non-empty string when provided.");
  }
  return value.trim();
}

export async function executeExplainImage(
  args: Record<string, unknown>,
  context: VisionExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.explainImage) {
    throw new Error(
      "Image explanation is not configured. Choose a vision model in Nerve Settings → Tools.",
    );
  }

  const path = await resolveReadPath(context.cwd, args.path);
  const fileStat = await stat(path).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(pathNotFoundMessage("explain_image", args.path, path));
    }
    throw error;
  });
  if (!fileStat.isFile()) {
    throw new Error(`explain_image requires a regular file: ${path}`);
  }
  if (fileStat.size > EXPLAIN_IMAGE_MAX_BYTES) {
    throw new Error(
      `Image is too large for explain_image (${fileStat.size} bytes; maximum ${EXPLAIN_IMAGE_MAX_BYTES} bytes).`,
    );
  }

  const data = await readFile(path);
  const mimeType = detectSupportedImageMimeType(data);
  if (!mimeType) {
    throw new Error(
      "Unsupported image format. explain_image supports JPEG, PNG, GIF, and WebP files detected from their contents.",
    );
  }

  const response = await context.explainImage({
    path,
    data,
    mimeType,
    prompt: optionalPrompt(args.prompt),
    signal: context.signal,
    onUpdate: context.onUpdate,
  });
  const explanation = response.explanation.trim();
  if (!explanation) {
    throw new Error("The configured vision model returned no explanation.");
  }

  const result = await buildProcessTextResult({
    text: explanation,
    outputFilePrefix: "nerve-image-explanation",
    exitMessagePrefix: "Image explanation",
    dataDir: context.dataDir,
    details: {
      path,
      mimeType,
      byteSize: data.byteLength,
      model: response.model,
    },
  });
  return {
    ...result,
    details: {
      ...(result.details as Record<string, unknown> | undefined),
      explanation: result.content ?? "",
    },
  };
}

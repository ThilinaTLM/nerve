import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Sharp } from "sharp";

const RESIZE_TIMEOUT_MS = 30_000;
const MAX_HELPER_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_HELPER_STDERR_BYTES = 64 * 1024;

export interface ResizedImage {
  buffer: Buffer;
  mimeType: string;
  changed: boolean;
}

interface ResizeWorkerHeader {
  mimeType: string;
  changed: boolean;
  length: number;
}

/**
 * Electron's Node mode is not ABI-safe for Sharp/libvips in this app. Use a
 * one-shot Electron nativeImage helper there; ordinary Node can use Sharp.
 */
export async function resizeImage(
  source: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<ResizedImage> {
  if (process.versions.electron) {
    return await resizeImageInSubprocess(source, mimeType, maxDimension);
  }
  return await resizeImageWithSharp(source, mimeType, maxDimension);
}

export async function resizeImageWithSharp(
  source: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<ResizedImage> {
  const sharp = (await import("sharp")).default;
  const image = sharp(source);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return { buffer: source, mimeType, changed: false };
  }
  if (metadata.width <= maxDimension && metadata.height <= maxDimension) {
    return { buffer: source, mimeType, changed: false };
  }

  const resized = image.resize({
    width: maxDimension,
    height: maxDimension,
    fit: "inside",
    withoutEnlargement: true,
  });
  const encoded = await encodeResizedImage(resized, mimeType);
  return { ...encoded, changed: true };
}

async function resizeImageInSubprocess(
  source: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<ResizedImage> {
  const workerPath = fileURLToPath(
    new URL("./image-resize-worker.js", import.meta.url),
  );

  return await new Promise<ResizedImage>((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      process.execPath,
      [workerPath, String(maxDimension), mimeType],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settleReject(new Error("Image resize helper timed out."));
    }, RESIZE_TIMEOUT_MS);
    timeout.unref();

    function cleanup(): void {
      clearTimeout(timeout);
    }

    function settleReject(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function settleResolve(image: ResizedImage): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settleReject(new Error("Image resize helper output was too large."));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_HELPER_STDERR_BYTES) return;
      stderr += chunk
        .toString("utf8")
        .slice(0, MAX_HELPER_STDERR_BYTES - stderr.length);
    });

    child.stdin.on("error", (error) => {
      settleReject(error);
    });
    child.once("error", (error) => {
      settleReject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim();
        settleReject(
          new Error(
            `Image resize helper failed${signal ? ` (${signal})` : ` (${code ?? "unknown"})`}${detail ? `: ${detail}` : "."}`,
          ),
        );
        return;
      }

      try {
        settleResolve(parseWorkerOutput(Buffer.concat(stdout)));
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.stdin.end(source);
  });
}

function parseWorkerOutput(output: Buffer): ResizedImage {
  const headerEnd = output.indexOf(0x0a);
  if (headerEnd < 0) throw new Error("Image resize helper returned no header.");

  const header = JSON.parse(
    output.toString("utf8", 0, headerEnd),
  ) as ResizeWorkerHeader;
  if (
    typeof header.mimeType !== "string" ||
    typeof header.changed !== "boolean" ||
    !Number.isSafeInteger(header.length) ||
    header.length < 1
  ) {
    throw new Error("Image resize helper returned an invalid header.");
  }

  const buffer = output.subarray(headerEnd + 1);
  if (buffer.length !== header.length) {
    throw new Error("Image resize helper returned an incomplete image.");
  }
  return { buffer, mimeType: header.mimeType, changed: header.changed };
}

async function encodeResizedImage(
  image: Sharp,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return { buffer: await image.jpeg().toBuffer(), mimeType: "image/jpeg" };
    case "image/png":
      return { buffer: await image.png().toBuffer(), mimeType: "image/png" };
    case "image/webp":
      return { buffer: await image.webp().toBuffer(), mimeType: "image/webp" };
    default:
      return { buffer: await image.png().toBuffer(), mimeType: "image/png" };
  }
}

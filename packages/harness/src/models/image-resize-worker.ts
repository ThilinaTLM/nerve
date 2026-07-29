import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const JPEG_QUALITY = 90;

interface NativeImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: {
    width: number;
    height: number;
    quality: "best";
  }): NativeImageLike;
  toJPEG(quality: number): Buffer;
  toPNG(): Buffer;
}

interface BrowserWindowLike {
  loadURL(url: string): Promise<void>;
  webContents: {
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>;
  };
  destroy(): void;
}

interface ElectronApi {
  app: {
    whenReady(): Promise<void>;
    quit(): void;
  };
  BrowserWindow: new (options: {
    show: boolean;
    webPreferences: { contextIsolation: boolean; sandbox: boolean };
  }) => BrowserWindowLike;
  nativeImage: {
    createFromBuffer(buffer: Buffer): NativeImageLike;
  };
}

interface CanvasResizeResult {
  data: string;
  width: number;
  height: number;
}

const require = createRequire(import.meta.url);
const electron = require("electron") as ElectronApi;

async function main(): Promise<void> {
  const maxDimension = Number(process.argv[2]);
  const mimeType = process.argv[3];
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1 || !mimeType) {
    throw new Error(
      "Expected a positive max dimension and an image MIME type.",
    );
  }

  const source = await readInput();
  await electron.app.whenReady();
  const resized = await resizeWithElectron(source, mimeType, maxDimension);
  const header = Buffer.from(
    `${JSON.stringify({
      mimeType: resized.mimeType,
      changed: resized.changed,
      length: resized.buffer.length,
    })}\n`,
  );
  await writeOutput(Buffer.concat([header, resized.buffer]));
  electron.app.quit();
}

async function readInput(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    inputBytes += buffer.length;
    if (inputBytes > MAX_INPUT_BYTES) {
      throw new Error("Image resize helper input was too large.");
    }
    chunks.push(buffer);
  }
  if (inputBytes === 0)
    throw new Error("Image resize helper received no image.");
  return Buffer.concat(chunks);
}

async function resizeWithElectron(
  source: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<{ buffer: Buffer; mimeType: string; changed: boolean }> {
  const image = electron.nativeImage.createFromBuffer(source);
  if (!image.isEmpty()) {
    const size = image.getSize();
    if (size.width <= maxDimension && size.height <= maxDimension) {
      return { buffer: source, mimeType, changed: false };
    }

    const target = fitInside(size.width, size.height, maxDimension);
    const resized = image.resize({ ...target, quality: "best" });
    if (mimeType.toLowerCase() === "image/jpeg") {
      return {
        buffer: resized.toJPEG(JPEG_QUALITY),
        mimeType: "image/jpeg",
        changed: true,
      };
    }
    return { buffer: resized.toPNG(), mimeType: "image/png", changed: true };
  }

  return await resizeWithCanvas(source, mimeType, maxDimension);
}

async function resizeWithCanvas(
  source: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<{ buffer: Buffer; mimeType: string; changed: boolean }> {
  const window = new electron.BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    await window.loadURL("data:text/html,<html><body></body></html>");
    const dataUrl = `data:${mimeType};base64,${source.toString("base64")}`;
    const result = await window.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(1, ${maxDimension} / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          if (scale === 1) {
            resolve({ data: "", width: image.width, height: image.height });
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Could not create image canvas."));
            return;
          }
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, width, height);
          resolve({ data: canvas.toDataURL("image/png"), width, height });
        };
        image.onerror = () => reject(new Error("Unsupported image format."));
        image.src = ${JSON.stringify(dataUrl)};
      })`,
      true,
    );
    if (!isCanvasResizeResult(result)) {
      throw new Error("Image canvas returned an invalid result.");
    }
    if (!result.data) return { buffer: source, mimeType, changed: false };
    const separator = result.data.indexOf(",");
    if (separator < 0) throw new Error("Image canvas returned invalid data.");
    return {
      buffer: Buffer.from(result.data.slice(separator + 1), "base64"),
      mimeType: "image/png",
      changed: true,
    };
  } finally {
    window.destroy();
  }
}

function fitInside(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function isCanvasResizeResult(value: unknown): value is CanvasResizeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<CanvasResizeResult>;
  return (
    typeof result.data === "string" &&
    typeof result.width === "number" &&
    typeof result.height === "number"
  );
}

async function writeOutput(output: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  electron.app.quit();
});

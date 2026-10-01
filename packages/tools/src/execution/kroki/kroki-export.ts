import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { krokiToolSettingsSchema } from "@nervekit/contracts/settings";
import {
  krokiDiagramTypeSchema,
  krokiOutputFormatSchema,
  type KrokiExportResultDetails,
} from "@nervekit/contracts/tools";
import type {
  KrokiExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { withTimeoutSignal } from "../process/abort.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { detectSupportedImageMimeType } from "../filesystem/read.js";
import {
  isErrnoException,
  pathNotFoundMessage,
  resolveReadPath,
  resolveToCwd,
} from "../filesystem/path.js";
import { startsWithSvgRoot } from "./svg-header.js";

const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

async function readBounded(
  response: Response,
  limit: number,
  signal: AbortSignal,
  truncate = false,
): Promise<Buffer> {
  if (!truncate && Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error(`Kroki output exceeds ${limit} bytes.`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (bytes + value.byteLength > limit) {
        if (!truncate) throw new Error(`Kroki output exceeds ${limit} bytes.`);
        chunks.push(value.subarray(0, limit - bytes));
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
      if (truncate && bytes === limit) break;
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readDiagramSource(
  args: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const hasPath = args.source_path !== undefined;
  if (hasPath === (args.source !== undefined))
    throw new Error("Provide exactly one of source_path or source.");
  let source = args.source;
  if (hasPath) {
    if (typeof args.source_path !== "string" || !args.source_path.trim())
      throw new Error("source_path must be a non-empty string.");
    const path = await resolveReadPath(cwd, args.source_path);
    const info = await stat(path).catch((error: unknown) => {
      if (isErrnoException(error) && error.code === "ENOENT")
        throw new Error(
          pathNotFoundMessage("kroki_export", args.source_path, path),
        );
      throw error;
    });
    if (!info.isFile())
      throw new Error(`source_path must be a regular file: ${path}`);
    if (info.size > MAX_SOURCE_BYTES)
      throw new Error(
        `source_path must not exceed ${MAX_SOURCE_BYTES} bytes (${info.size} bytes).`,
      );
    source = await readFile(path, "utf8");
  }
  const label = hasPath ? "source_path file" : "source";
  if (typeof source !== "string" || !source.trim())
    throw new Error(`${label} must be non-empty.`);
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES)
    throw new Error(
      `${label} must not exceed ${MAX_SOURCE_BYTES} UTF-8 bytes.`,
    );
  return source;
}

/** Explicit format wins; otherwise the output extension decides; SVG last. */
function resolveOutput(
  args: Record<string, unknown>,
  cwd: string,
): { path?: string; format: "svg" | "png" } {
  const explicit =
    args.output_format === undefined
      ? undefined
      : krokiOutputFormatSchema.parse(args.output_format);
  if (args.output_path === undefined) return { format: explicit ?? "svg" };
  if (typeof args.output_path !== "string" || !args.output_path.trim())
    throw new Error("output_path must be a non-empty string.");
  const path = resolveToCwd(cwd, args.output_path);
  const extension = extname(path).slice(1).toLowerCase();
  if (extension !== "svg" && extension !== "png")
    throw new Error("output_path must end in .svg or .png.");
  if (explicit && explicit !== extension)
    throw new Error(
      `output_format ${explicit} does not match output_path extension .${extension}.`,
    );
  return { path, format: extension };
}

export async function executeKrokiExport(
  args: Record<string, unknown>,
  context: KrokiExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.kroki) throw new Error("Kroki is not configured in Settings.");
  const { url } = krokiToolSettingsSchema.parse(context.kroki);
  const diagramType = krokiDiagramTypeSchema.parse(args.diagram_type);
  const output = resolveOutput(args, context.cwd);
  const outputFormat = output.format;
  const managed = !output.path;
  const path =
    output.path ??
    (context.artifactDir &&
      join(context.artifactDir, `diagram.${outputFormat}`));
  if (!path)
    throw new Error("Kroki export requires an artifact output directory.");
  const source = await readDiagramSource(args, context.cwd);
  const mediaType = outputFormat === "svg" ? "image/svg+xml" : "image/png";
  const signal = withTimeoutSignal(context.signal, 60_000);
  signal.throwIfAborted();
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Accept: mediaType },
    body: JSON.stringify({
      diagram_source: source,
      diagram_type: diagramType,
      output_format: outputFormat,
    }),
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ToolExecutionError(
      "KROKI_REDIRECT",
      "Kroki redirects are not allowed. Configure the final server URL in Settings.",
    );
  }
  if (!response.ok) {
    const body = await readBounded(response, 4 * 1024, signal, true);
    const diagnostic = body
      .toString("utf8")
      .replaceAll(source, "[diagram source omitted]")
      .replace(/<[^>]*>/g, " ")
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 512);
    throw new ToolExecutionError(
      "KROKI_HTTP_ERROR",
      `Kroki returned HTTP ${response.status}${diagnostic ? `: ${diagnostic}` : "."}`,
    );
  }
  if (
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== mediaType
  ) {
    await response.body?.cancel();
    throw new Error(`Kroki did not return ${mediaType}.`);
  }
  const data = await readBounded(response, MAX_RESPONSE_BYTES, signal);
  if (!data.byteLength) throw new Error("Kroki returned an empty diagram.");
  const valid =
    outputFormat === "png"
      ? detectSupportedImageMimeType(data) === "image/png"
      : startsWithSvgRoot(data.subarray(0, 512).toString("utf8"));
  if (!valid)
    throw new Error(
      `Kroki returned invalid ${outputFormat.toUpperCase()} data.`,
    );
  signal.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  signal.throwIfAborted();
  await writeFile(path, data, { signal });
  signal.throwIfAborted();
  const details: KrokiExportResultDetails = {
    diagramType,
    outputFormat,
    path,
    filename: basename(path),
    mediaType,
    bytes: data.byteLength,
    // Only managed files are claimed: artifact validation rejects any path
    // outside the tool-call directory, and the agent chose output_path anyway.
    ...(managed
      ? {
          outputLimits: {
            artifacts: [
              {
                role: "primary_result" as const,
                path,
                format: { kind: "image" as const, mediaType },
                bytes: data.byteLength,
                label: "Exported diagram",
                recommendedTools:
                  outputFormat === "png"
                    ? ["read" as const, "explain_image" as const]
                    : ["read" as const],
              },
            ],
          },
        }
      : {}),
  };
  const content = `Exported ${diagramType} diagram as ${outputFormat.toUpperCase()}: ${path}`;
  return { content, contentBlocks: [{ type: "text", text: content }], details };
}

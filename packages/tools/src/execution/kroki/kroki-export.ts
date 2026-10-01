import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

export async function executeKrokiExport(
  args: Record<string, unknown>,
  context: KrokiExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.kroki) throw new Error("Kroki is not configured in Settings.");
  if (!context.artifactDir)
    throw new Error("Kroki export requires an artifact output directory.");
  const { url } = krokiToolSettingsSchema.parse(context.kroki);
  const diagramType = krokiDiagramTypeSchema.parse(args.diagram_type);
  const outputFormat = krokiOutputFormatSchema.parse(
    args.output_format ?? "svg",
  );
  const source = args.source;
  if (typeof source !== "string" || !source.trim())
    throw new Error("source must be a non-empty string.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES)
    throw new Error(`source must not exceed ${MAX_SOURCE_BYTES} UTF-8 bytes.`);
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
  const svgHeader = data
    .subarray(0, 512)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  const valid =
    outputFormat === "png"
      ? detectSupportedImageMimeType(data) === "image/png"
      : /^\s*(?:<\?xml[^?]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE svg[^>]*>)\s*)*<svg(?:\s|>)/i.test(
          svgHeader,
        );
  if (!valid)
    throw new Error(
      `Kroki returned invalid ${outputFormat.toUpperCase()} data.`,
    );
  signal.throwIfAborted();
  await mkdir(context.artifactDir, { recursive: true });
  signal.throwIfAborted();
  const filename = `diagram.${outputFormat}`;
  const path = join(context.artifactDir, filename);
  await writeFile(path, data, { signal });
  signal.throwIfAborted();
  const details: KrokiExportResultDetails = {
    diagramType,
    outputFormat,
    path,
    filename,
    mediaType,
    bytes: data.byteLength,
    outputLimits: {
      artifacts: [
        {
          role: "primary_result",
          path,
          format: { kind: "image", mediaType },
          bytes: data.byteLength,
          label: "Exported diagram",
          recommendedTools:
            outputFormat === "png" ? ["read", "explain_image"] : ["read"],
        },
      ],
    },
  };
  const content = `Exported ${diagramType} diagram as ${outputFormat.toUpperCase()}.`;
  return { content, contentBlocks: [{ type: "text", text: content }], details };
}

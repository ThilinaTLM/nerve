import {
  detectSupportedImageMimeType,
  ToolExecutionError,
} from "@nervekit/tools/execution";
import { startsWithSvgRoot } from "./svg-header.js";

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

/** POSTs a diagram to Kroki and returns validated output bytes (`diagram.render`). */
export async function fetchKrokiDiagram(options: {
  url: string;
  diagramType: string;
  source: string;
  outputFormat: "svg" | "png";
  signal: AbortSignal;
}): Promise<Buffer> {
  const { url, diagramType, source, outputFormat, signal } = options;
  const mediaType = outputFormat === "svg" ? "image/svg+xml" : "image/png";
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
  return data;
}

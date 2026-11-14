import { ExtensionError, type ExtensionContext } from "@nervekit/extension-api";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A Kroki diagram engine name (`mermaid`, `plantuml`, …). */
export const KROKI_DIAGRAM_TYPE = /^[a-z][a-z0-9-]{0,63}$/;

/** Which part of an error body is worth showing: text only, without the diagram source. */
function diagnosticOf(body: unknown, source: string): string {
  const text =
    body instanceof Uint8Array
      ? new TextDecoder().decode(body.subarray(0, 4 * 1024))
      : "";
  return text
    .replaceAll(source, "[diagram source omitted]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
}

/** POSTs a diagram to the Kroki server and returns validated PNG bytes (`diagram.render`). */
export async function fetchKrokiDiagram(
  ctx: ExtensionContext,
  options: { url: string; diagramType: string; source: string },
): Promise<Uint8Array> {
  const { url, diagramType, source } = options;
  const response = await ctx.http.request({
    url,
    method: "POST",
    headers: { accept: "image/png" },
    body: {
      json: {
        diagram_source: source,
        diagram_type: diagramType,
        output_format: "png",
      },
    },
    response: "bytes",
    maxBytes: MAX_RESPONSE_BYTES,
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    const diagnostic = diagnosticOf(response.body, source);
    throw new ExtensionError(
      response.status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST",
      `Kroki returned HTTP ${response.status}${diagnostic ? `: ${diagnostic}` : "."}`,
    );
  }
  if (
    response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
    "image/png"
  )
    throw new ExtensionError("SERVER_ERROR", "Kroki did not return image/png.");
  const data = response.body as Uint8Array;
  if (!data.byteLength)
    throw new ExtensionError(
      "SERVER_ERROR",
      "Kroki returned an empty diagram.",
    );
  if (!PNG_SIGNATURE.every((byte, index) => data[index] === byte))
    throw new ExtensionError(
      "SERVER_ERROR",
      "Kroki returned invalid PNG data.",
    );
  return data;
}

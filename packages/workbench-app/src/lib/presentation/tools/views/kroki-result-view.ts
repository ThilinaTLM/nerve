import { krokiExportResultDetailsSchema } from "@nervekit/contracts/tools";
import { parseToolExecutionResult } from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Mirrors the executor: explicit format, then output extension, then SVG. */
export function krokiConversion(args: {
  diagram_type?: unknown;
  output_format?: unknown;
  output_path?: unknown;
}): string {
  const extension = stringArg(args.output_path)
    ?.match(/\.(svg|png)$/i)?.[1]
    ?.toLowerCase();
  const format = stringArg(args.output_format) ?? extension ?? "svg";
  return `${stringArg(args.diagram_type) ?? "diagram"} → ${format.toUpperCase()}`;
}

export function parseKrokiView(
  rawArgs: Record<string, unknown>,
  rawResult: unknown,
): Extract<ToolView, { kind: "kroki_export" }> {
  const details = krokiExportResultDetailsSchema.safeParse(
    parseToolExecutionResult(rawResult)?.details,
  );
  if (!details.success)
    return { kind: "kroki_export", conversion: krokiConversion(rawArgs) };
  return {
    kind: "kroki_export",
    conversion: krokiConversion({
      diagram_type: details.data.diagramType,
      output_format: details.data.outputFormat,
    }),
    path: details.data.path,
    bytes: details.data.bytes,
  };
}

import {
  krokiDiagramTypeSchema,
  krokiExportResultDetailsSchema,
  krokiOutputFormatSchema,
} from "@nervekit/contracts/tools";
import { asRecord, parseToolExecutionResult } from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

export function parseKrokiView(
  rawArgs: unknown,
  rawResult: unknown,
): Extract<ToolView, { kind: "kroki_export" }> {
  const args = asRecord(rawArgs);
  const details = krokiExportResultDetailsSchema.safeParse(
    parseToolExecutionResult(rawResult)?.details,
  );
  const diagramType = krokiDiagramTypeSchema.safeParse(args.diagram_type);
  const outputFormat = krokiOutputFormatSchema.safeParse(
    args.output_format ?? "svg",
  );
  return {
    kind: "kroki_export",
    diagramType: details.success
      ? details.data.diagramType
      : diagramType.success
        ? diagramType.data
        : undefined,
    outputFormat: details.success
      ? details.data.outputFormat
      : outputFormat.success
        ? outputFormat.data
        : undefined,
    path: details.success ? details.data.path : undefined,
    bytes: details.success ? details.data.bytes : undefined,
  };
}

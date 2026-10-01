import { krokiExportResultDetailsSchema } from "@nervekit/contracts/tools";
import { parseToolExecutionResult } from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

export function parseKrokiView(
  rawResult: unknown,
): Extract<ToolView, { kind: "kroki_export" }> {
  const details = krokiExportResultDetailsSchema.safeParse(
    parseToolExecutionResult(rawResult)?.details,
  );
  return details.success
    ? {
        kind: "kroki_export",
        path: details.data.path,
        bytes: details.data.bytes,
      }
    : { kind: "kroki_export" };
}

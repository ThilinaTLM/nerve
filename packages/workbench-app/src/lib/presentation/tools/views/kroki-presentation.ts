import type { ToolView } from "./tool-view-types";
import type { ToolPresentation } from "./tool-presentation-types";
import { formatBytes } from "./tool-presentation-helpers";

/** The header comes from the call arguments; results only add the file size. */
export function krokiPresentation(
  view: Extract<ToolView, { kind: "kroki_export" }>,
  base: ToolPresentation,
): ToolPresentation {
  const size = view.path ? formatBytes(view.bytes) : undefined;
  return {
    ...base,
    meta: size ? [{ text: size, tone: "success" }] : [],
  };
}

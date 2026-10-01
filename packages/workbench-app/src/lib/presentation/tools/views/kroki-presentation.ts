import type { ToolView } from "./tool-view-types";
import type { ToolPresentation } from "./tool-presentation-types";
import { formatBytes } from "./tool-presentation-helpers";

export function krokiPresentation(
  view: Extract<ToolView, { kind: "kroki_export" }>,
  base: ToolPresentation,
): ToolPresentation {
  const size = formatBytes(view.bytes);
  return {
    ...base,
    primaryArg: view.diagramType
      ? {
          text: `${view.diagramType} → ${(view.outputFormat ?? "svg").toUpperCase()}`,
        }
      : base.primaryArg,
    meta: view.path
      ? [
          { text: (view.outputFormat ?? "svg").toUpperCase() },
          ...(size ? [{ text: size }] : []),
        ]
      : [],
  };
}

import type { ToolView } from "./tool-view-types";
import type { MetaItem } from "../../cards/card-presentation";
import type { ToolPresentation } from "./tool-presentation-types";
import { formatBytes } from "./tool-presentation-helpers";

/**
 * The header comes from the call arguments. Argument meta is dropped once a
 * call completes, so the conversion tag is re-emitted here with the size.
 */
export function krokiPresentation(
  view: Extract<ToolView, { kind: "kroki_export" }>,
  base: ToolPresentation,
): ToolPresentation {
  const meta: MetaItem[] = [{ text: view.conversion }];
  const size = view.path ? formatBytes(view.bytes) : undefined;
  if (size) meta.push({ text: size, tone: "success" });
  return { ...base, meta };
}

import type { ToolView } from "./tool-view-types";
import type { ToolPresentation } from "./tool-presentation-types";

export function generateImagePresentation(
  view: Extract<ToolView, { kind: "generate_image" }>,
  base: ToolPresentation,
): ToolPresentation {
  return {
    ...base,
    primaryArg: view.prompt ? { text: view.prompt } : base.primaryArg,
    meta:
      view.paths.length > 0
        ? [
            {
              key: "images",
              text: `${view.paths.length} image${view.paths.length === 1 ? "" : "s"}`,
              tone: "success",
            },
            ...view.paths.map((path, index) => ({
              key: `image-path:${index}`,
              text: path,
              mono: true,
              openPath: path,
            })),
          ]
        : [],
  };
}

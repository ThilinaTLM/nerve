import mermaid from "mermaid";
import DOMPurify from "dompurify";
import { checkDiagram } from "../../schema/diagram.js";
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  suppressErrorRendering: true,
  maxTextSize: 262144,
  maxEdges: 500,
  flowchart: { htmlLabels: false },
});
let sequence = 0;
// Mermaid uses shared rendering state; serialize diagrams even when elements load together.
let queue: Promise<unknown> = Promise.resolve();
export function render(source: string): Promise<string> {
  checkDiagram(source);
  const result = queue.then(async () => {
    const { svg } = await mermaid.render(
      `richdoc-diagram-${++sequence}`,
      source,
    );
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "script"],
      FORBID_ATTR: ["onload", "onclick", "href", "xlink:href"],
    });
  });
  queue = result.catch(() => undefined);
  return result;
}

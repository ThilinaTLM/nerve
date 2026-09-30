import { ELEMENTS } from "../schema/index.js";
import { Page, Card, Callout, Stat, Toc } from "./page.js";
import { Code, MathBlock, Diagram, Chart, Icon } from "./technical.js";
const implementations: Record<string, CustomElementConstructor> = {
  "rd-page": Page,
  "rd-cols": class extends HTMLElement {},
  "rd-card": Card,
  "rd-callout": Callout,
  "rd-badge": class extends HTMLElement {},
  "rd-stat": Stat,
  "rd-code": Code,
  "rd-math": MathBlock,
  "rd-diagram": Diagram,
  "rd-chart": Chart,
  "rd-toc": Toc,
  "rd-icon": Icon,
};
for (const name of Object.keys(ELEMENTS)) {
  const implementation = implementations[name];
  if (!implementation)
    throw new Error(`Missing runtime implementation: ${name}`);
  if (!customElements.get(name)) customElements.define(name, implementation);
}

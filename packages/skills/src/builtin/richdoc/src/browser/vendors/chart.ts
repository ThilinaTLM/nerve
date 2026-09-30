import * as Plot from "@observablehq/plot";
import { arc, pie, schemeTableau10 } from "d3";
import { checkChart } from "../../schema/index.js";
export function render(
  rows: Record<string, string | number>[],
  options: {
    x: string;
    y: string;
    kind: string;
    series?: string;
    width: number;
    sparkline: boolean;
    title: string;
  },
): HTMLElement | SVGSVGElement {
  const { x, y, kind, series, width, sparkline } = options;
  checkChart(rows, x, y, kind, series);
  if (kind === "donut") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-120 -120 240 240");
    svg.setAttribute("width", String(Math.min(width, 320)));
    const slices = pie<Record<string, string | number>>().value((r) =>
      Number(r[y]),
    )(rows);
    const shape = arc<(typeof slices)[number]>()
      .innerRadius(65)
      .outerRadius(105);
    slices.forEach((slice, i) => {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", shape(slice) ?? "");
      path.setAttribute("fill", schemeTableau10[i % 10]);
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = `${slice.data[x]}: ${slice.data[y]}`;
      path.append(title);
      svg.append(path);
    });
    return svg;
  }
  const common = {
    x,
    y,
    stroke: series ?? "var(--rd-accent)",
    ...(series ? { z: series } : {}),
  };
  const marks =
    kind === "bar"
      ? [Plot.barY(rows, { x, y, fill: series ?? "var(--rd-accent)" })]
      : kind === "area"
        ? [
            Plot.areaY(rows, {
              ...common,
              fill: series ?? "var(--rd-accent)",
              fillOpacity: 0.2,
            }),
            Plot.lineY(rows, common),
          ]
        : kind === "scatter"
          ? [Plot.dot(rows, { ...common, fill: series ?? "var(--rd-accent)" })]
          : kind === "heatmap"
            ? [Plot.cell(rows, { x, y: series ?? x, fill: y })]
            : [Plot.lineY(rows, common)];
  return Plot.plot({
    style: {
      fontFamily: "var(--rd-font-body)",
      fontSize: "12px",
      color: "var(--rd-foreground)",
      background: "transparent",
    },
    width: Math.max(180, Math.min(width, 1200)),
    height: sparkline ? 70 : 300,
    marginLeft: sparkline ? 0 : 50,
    marginBottom: sparkline ? 0 : 40,
    x: { axis: sparkline ? null : "bottom" },
    y: { axis: sparkline ? null : "left", grid: !sparkline },
    color: { legend: !!series && !sparkline },
    marks,
  });
}

export const VERSION = "1.0.0";
export const ICONS = [
  "arrow-right",
  "arrow-left",
  "chevron-right",
  "chevron-down",
  "check",
  "x",
  "plus",
  "minus",
  "info",
  "triangle-alert",
  "circle-check",
  "circle-x",
  "lightbulb",
  "target",
  "clock",
  "calendar",
  "user",
  "users",
  "file-text",
  "code",
  "chart-no-axes-combined",
  "link",
  "external-link",
  "copy",
] as const;
export const LANGUAGES = [
  "javascript",
  "typescript",
  "json",
  "python",
  "bash",
  "sql",
  "html",
  "css",
  "markdown",
  "diff",
] as const;
export const TONES = ["info", "success", "warning", "destructive", "muted"];
export interface Attribute {
  values?: readonly string[];
  required?: boolean;
  description: string;
}
export interface ElementSpec {
  description: string;
  attributes: Record<string, Attribute>;
  example: string;
}
const attr = (
  description: string,
  values?: readonly string[],
  required = false,
): Attribute => ({
  description,
  ...(values ? { values } : {}),
  ...(required ? { required } : {}),
});
export const ELEMENTS: Record<string, ElementSpec> = {
  "rd-page": {
    description: "Exactly one page, directly under body.",
    attributes: {
      theme: attr("Presentation theme", ["editorial-warm", "graphite-modern"]),
      mode: attr("Colour mode", ["light", "dark", "auto"]),
      width: attr("Content width", ["narrow", "standard", "wide", "full"]),
      toc: attr("TOC position", ["auto", "left", "right", "top"]),
      prefs: attr("Disable reader controls", ["off"]),
    },
    example: '<rd-page mode="auto"><header><h1>Report</h1></header></rd-page>',
  },
  "rd-cols": {
    description: "Responsive parallel content, not newspaper prose.",
    attributes: { n: attr("Column count", ["2", "3", "4"]) },
    example:
      '<rd-cols n="2"><rd-card>Option A</rd-card><rd-card>Option B</rd-card></rd-cols>',
  },
  "rd-card": {
    description: "Visual grouping.",
    attributes: { title: attr("Card heading"), accent: attr("Accent", TONES) },
    example: '<rd-card title="Recommendation"><p>Choose A.</p></rd-card>',
  },
  "rd-callout": {
    description: "Editorial emphasis.",
    attributes: {
      type: attr(
        "Meaning",
        [...TONES.filter((t) => t !== "muted"), "note", "tldr"],
        true,
      ),
      title: attr("Optional heading"),
    },
    example:
      '<rd-callout type="tldr"><p>Two-sentence summary.</p></rd-callout>',
  },
  "rd-badge": {
    description: "Compact status label.",
    attributes: { variant: attr("Meaning", TONES) },
    example: '<rd-badge variant="success">Accepted</rd-badge>',
  },
  "rd-stat": {
    description: "Metric with optional delta and nested sparkline.",
    attributes: {
      value: attr("Metric value", undefined, true),
      label: attr("Metric label", undefined, true),
      delta: attr("Change description"),
      tone: attr("Change meaning", ["positive", "negative", "neutral"]),
    },
    example:
      '<rd-stat value="42" label="Deployments" delta="+8 this week"></rd-stat>',
  },
  "rd-code": {
    description:
      "Escaped code source, highlighting and copy. Diff uses format=diff.",
    attributes: {
      lang: attr("Highlight language; unsupported values use plain text"),
      title: attr("Block heading"),
      format: attr("Presentation", ["code", "diff"]),
    },
    example: '<rd-code lang="typescript">const ok = true;</rd-code>',
  },
  "rd-math": {
    description: "LaTeX source, not HTML.",
    attributes: { display: attr("Math layout", ["inline", "block"]) },
    example: '<rd-math display="block">E = mc^2</rd-math>',
  },
  "rd-diagram": {
    description: "Local Mermaid source only; never sends source to a server.",
    attributes: {
      lang: attr("Diagram language", ["mermaid"]),
      caption: attr("Accessible description", undefined, true),
    },
    example:
      '<rd-diagram lang="mermaid" caption="Request flow">graph TD\n  Client --> Server</rd-diagram>',
  },
  "rd-chart": {
    description: "Inline JSON/CSV data with readable table fallback.",
    attributes: {
      kind: attr("Chart kind", [
        "bar",
        "line",
        "area",
        "donut",
        "scatter",
        "heatmap",
      ]),
      variant: attr("Presentation", ["chart", "sparkline"]),
      format: attr("Source format", ["json", "csv"]),
      x: attr("X column", undefined, true),
      y: attr("Y column", undefined, true),
      series: attr("Grouping column"),
      title: attr("Accessible chart heading", undefined, true),
      caption: attr("Additional explanation"),
    },
    example:
      '<rd-chart kind="bar" x="name" y="value" title="Results">[{"name":"A","value":12},{"name":"B","value":9}]</rd-chart>',
  },
  "rd-toc": {
    description: "Navigation generated from authored h2/h3 headings.",
    attributes: { title: attr("Navigation label") },
    example: '<rd-toc title="Contents"></rd-toc>',
  },
  "rd-icon": {
    description: "Bundled icon; decorative unless label supplied.",
    attributes: {
      name: attr("Icon name", ICONS, true),
      label: attr("Informative accessible label"),
    },
    example: '<rd-icon name="info" label="Information"></rd-icon>',
  },
};

export const GLOBAL_ATTRIBUTES = new Set([
  "id",
  "class",
  "lang",
  "dir",
  "title",
  "role",
  "tabindex",
  "hidden",
]);
export function describe(tag?: string) {
  if (tag) {
    if (!ELEMENTS[tag]) throw new Error(`Unknown element: ${tag}`);
    return {
      tag,
      ...ELEMENTS[tag],
      ...(tag === "rd-code" ? { languages: LANGUAGES } : {}),
    };
  }
  return {
    version: VERSION,
    elements: Object.entries(ELEMENTS).map(([name, spec]) => ({
      name,
      description: spec.description,
    })),
    diagrams: ["mermaid"],
    languages: LANGUAGES,
    icons: ICONS,
  };
}

export function parseChart(
  source: string,
  format = "json",
): Record<string, string | number>[] {
  let rows: unknown;
  if (format === "csv") {
    // Quoted fields, commas and embedded newlines; deliberately no remote data sources.
    const records: string[][] = [];
    let row: string[] = [],
      field = "",
      quoted = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quoted && source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (!quoted && (c === "," || c === "\n")) {
        row.push(field.replace(/\r$/, ""));
        field = "";
        if (c === "\n") {
          if (row.some(Boolean)) records.push(row);
          row = [];
        }
      } else field += c;
    }
    if (quoted) throw new Error("Unterminated CSV quote.");
    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
    }
    const headers = records.shift() ?? [];
    if (
      !headers.length ||
      new Set(headers).size !== headers.length ||
      headers.some((h) => !h)
    )
      throw new Error("CSV needs unique nonempty column names.");
    rows = records.map((record) => {
      if (record.length !== headers.length)
        throw new Error("CSV row length does not match headers.");
      return Object.fromEntries(
        headers.map((h, i) => [
          h,
          record[i] !== "" && Number.isFinite(Number(record[i]))
            ? Number(record[i])
            : record[i],
        ]),
      );
    });
  } else rows = JSON.parse(source);
  if (!Array.isArray(rows) || !rows.length || rows.length > 10_000)
    throw new Error("Chart requires 1–10,000 rows.");
  if (
    rows.some(
      (r) =>
        !r ||
        typeof r !== "object" ||
        Array.isArray(r) ||
        Object.values(r).some(
          (v) =>
            !["string", "number"].includes(typeof v) ||
            (typeof v === "number" && !Number.isFinite(v)),
        ),
    )
  )
    throw new Error(
      "Chart rows must be objects with string or finite number values.",
    );
  return rows as Record<string, string | number>[];
}

export function checkChart(
  rows: Record<string, string | number>[],
  x: string,
  y: string,
  kind = "bar",
  series?: string,
) {
  if (
    !x ||
    !y ||
    rows.some((r) => !(x in r) || !(y in r) || (series && !(series in r)))
  )
    throw new Error("Chart columns must exist in every row.");
  if (rows.some((r) => typeof r[y] !== "number"))
    throw new Error("Y values must be finite numbers.");
  if (
    kind === "donut" &&
    (rows.some((r) => Number(r[y]) < 0) || !rows.some((r) => Number(r[y]) > 0))
  )
    throw new Error("Donut values must be nonnegative with a positive total.");
}

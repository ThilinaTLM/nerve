import { element, load } from "./load.js";
import { parseChart } from "../schema/index.js";

abstract class Technical extends HTMLElement {
  private initialized = false;
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    const source = this.textContent ?? "";
    this.dataset.state = "loading";
    void this.render(source)
      .then(() => {
        this.dataset.state = "ready";
      })
      .catch((error: unknown) => {
        this.replaceChildren(
          element("pre", source),
          element(
            "small",
            `Rendering unavailable: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        this.dataset.state = "error";
      });
  }
  abstract render(source: string): Promise<void>;
}
export class Code extends Technical {
  async render(source: string) {
    const renderer = await load("code");
    const container = element("div");
    container.innerHTML = await renderer.render(
      source,
      this.getAttribute("format") === "diff"
        ? "diff"
        : (this.getAttribute("lang") ?? "text"),
    );
    const toolbar = element("div");
    toolbar.dataset.rdToolbar = "true";
    toolbar.append(
      element(
        "span",
        this.getAttribute("title") ?? this.getAttribute("lang") ?? "Code",
      ),
    );
    const button = element("button", "Copy");
    button.type = "button";
    button.setAttribute("aria-label", "Copy code");
    button.addEventListener("click", () => {
      void (async () => {
        try {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(source);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Select code to copy";
        }
      })();
    });
    toolbar.append(button);
    this.replaceChildren(toolbar, container);
  }
}
export class MathBlock extends Technical {
  async render(source: string) {
    const renderer = await load("math");
    this.innerHTML = renderer.render(
      source,
      this.getAttribute("display") !== "inline",
    );
  }
}
export class Diagram extends Technical {
  async render(source: string) {
    if (this.hasAttribute("lang") && this.getAttribute("lang") !== "mermaid")
      throw new Error("Only local Mermaid is supported.");
    const renderer = await load("diagram"),
      figure = element("figure"),
      image = element("div");
    image.innerHTML = await renderer.render(source);
    const caption = this.getAttribute("caption") ?? "Diagram";
    image.setAttribute("role", "img");
    image.setAttribute("aria-label", caption);
    figure.append(image, element("figcaption", caption));
    const details = element("details");
    details.append(
      element("summary", "Diagram source"),
      element("pre", source),
    );
    this.replaceChildren(figure, details);
  }
}
export class Chart extends Technical {
  async render(source: string) {
    const rows = parseChart(source, this.getAttribute("format") ?? "json");
    const x = this.getAttribute("x") ?? "",
      y = this.getAttribute("y") ?? "",
      kind = this.getAttribute("kind") ?? "bar";
    const title = this.getAttribute("title") ?? "Chart";
    const renderer = await load("chart"),
      figure = element("figure");
    const chart = renderer.render(rows, {
      x,
      y,
      kind,
      series: this.getAttribute("series") ?? undefined,
      width: this.clientWidth || 600,
      sparkline: this.getAttribute("variant") === "sparkline",
      title,
    });
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", title);
    figure.append(chart);
    if (this.hasAttribute("caption"))
      figure.append(element("figcaption", this.getAttribute("caption")!));
    const details = element("details");
    details.append(element("summary", "Chart data"));
    const table = element("table"),
      columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    table.append(element("caption", title));
    const head = element("thead"),
      header = element("tr");
    columns.forEach((name) => {
      const cell = element("th", name);
      cell.scope = "col";
      header.append(cell);
    });
    head.append(header);
    table.append(head);
    const body = element("tbody");
    rows.forEach((row) => {
      const tr = element("tr");
      columns.forEach((name) =>
        tr.append(element("td", String(row[name] ?? ""))),
      );
      body.append(tr);
    });
    table.append(body);
    details.append(table);
    const heading = element("p", title);
    heading.dataset.rdChartTitle = "true";
    this.replaceChildren(
      ...(this.getAttribute("variant") === "sparkline" ? [] : [heading]),
      figure,
      details,
    );
  }
}
export class Icon extends Technical {
  private cleanup?: () => void;
  async render() {
    const renderer = await load("icon"),
      container = element("span");
    const label = this.getAttribute("label");
    if (label) {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", label);
    } else this.setAttribute("aria-hidden", "true");
    this.replaceChildren(container);
    this.cleanup = renderer.render(container, this.getAttribute("name") ?? "");
    if (!this.isConnected) this.cleanup();
  }
  disconnectedCallback() {
    this.cleanup?.();
  }
}

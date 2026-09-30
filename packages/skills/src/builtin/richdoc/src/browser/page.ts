import { element, load } from "./load.js";
export class Page extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = "true";
    if (this.getAttribute("prefs") === "off") return;
    const fields = {
      theme: ["editorial-warm", "graphite-modern"],
      mode: ["auto", "light", "dark"],
      width: ["narrow", "standard", "wide", "full"],
      toc: ["auto", "left", "right", "top"],
    };
    const key = `richdoc:${location.pathname}`;
    let saved: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      )
        saved = parsed as Record<string, string>;
    } catch {
      /* Settings are optional when storage is unavailable. */
    }
    const panel = element("details");
    panel.dataset.rdControls = "true";
    const summary = element("summary", "Reader settings");
    summary.setAttribute("aria-label", "Reader settings");
    summary.title = "Reader settings";
    panel.append(summary);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.open = false;
        summary.focus();
      }
    });
    void load("icon")
      .then((renderer) => {
        summary.replaceChildren();
        renderer.settings(summary);
        summary.dataset.rdSettingsIcon = "true";
      })
      .catch(() => {
        summary.textContent = "Reader settings";
      });
    const form = element("div");
    for (const [name, values] of Object.entries(fields)) {
      const label = element("label", name[0].toUpperCase() + name.slice(1));
      const select = element("select");
      values.forEach((value) => {
        const option = element("option", value.replaceAll("-", " "));
        option.value = value;
        select.append(option);
      });
      const value = values.includes(saved[name])
        ? saved[name]
        : this.getAttribute(name);
      select.value =
        value && values.includes(value)
          ? value
          : name === "width"
            ? "standard"
            : values[0];
      this.setAttribute(name, select.value);
      select.addEventListener("change", () => {
        this.setAttribute(name, select.value);
        saved[name] = select.value;
        try {
          localStorage.setItem(key, JSON.stringify(saved));
        } catch {
          /* No persistence required. */
        }
      });
      label.append(select);
      form.append(label);
    }
    panel.append(form);
    this.append(panel);
  }
}
export class Card extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const title = this.getAttribute("title"),
      accent = this.getAttribute("accent");
    if (title || (accent && accent !== "muted")) {
      const header = element("div");
      header.dataset.rdCardHeader = "true";
      if (accent && accent !== "muted") {
        const kicker = element(
          "span",
          accent === "destructive" ? "Danger" : accent,
        );
        kicker.dataset.rdKicker = "true";
        header.append(kicker);
      }
      if (title) {
        const label = element("p", title);
        label.dataset.rdTitle = "true";
        header.append(label);
      }
      this.prepend(header);
    }
    this.dataset.ready = "true";
  }
}
export class Callout extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const body = element("div");
    body.dataset.rdBody = "true";
    body.append(...Array.from(this.childNodes));
    const type = this.getAttribute("type") ?? "info";
    const title =
      this.getAttribute("title") ??
      (type === "tldr"
        ? "TL;DR"
        : type === "destructive"
          ? "Danger"
          : type[0].toUpperCase() + type.slice(1));
    const label = element("p");
    label.dataset.rdTitle = "true";
    if (type !== "tldr") {
      const icon = document.createElement("rd-icon");
      const icons: Record<string, string> = {
        info: "info",
        success: "circle-check",
        warning: "triangle-alert",
        destructive: "circle-x",
        note: "lightbulb",
      };
      icon.setAttribute("name", icons[type] ?? "info");
      icon.setAttribute("aria-hidden", "true");
      label.append(icon);
    }
    label.append(element("span", title));
    this.append(label);
    this.append(body);
    this.dataset.ready = "true";
  }
}
export class Stat extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const value = element("strong", this.getAttribute("value") ?? ""),
      label = element("span", this.getAttribute("label") ?? "");
    value.dataset.rdValue = "true";
    label.dataset.rdLabel = "true";
    this.prepend(label, value);
    if (this.hasAttribute("delta")) {
      const delta = element("small", this.getAttribute("delta")!);
      delta.dataset.rdDelta = "true";
      this.insertBefore(delta, value.nextSibling);
    }
    this.dataset.ready = "true";
  }
}
export class Toc extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    const page = this.closest("rd-page");
    if (!page) return;
    const nav = element("nav");
    nav.setAttribute("aria-label", this.getAttribute("title") ?? "Contents");
    nav.append(element("strong", this.getAttribute("title") ?? "Contents"));
    const list = element("ol");
    const ids = new Set(
      [...document.querySelectorAll("[id]")].map((n) => n.id),
    );
    for (const heading of page.querySelectorAll("h2,h3")) {
      if (!heading.id) {
        const stem =
          heading.textContent
            ?.toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-|-$/g, "") || "section";
        let id = stem,
          index = 2;
        while (ids.has(id)) id = `${stem}-${index++}`;
        heading.id = id;
        ids.add(id);
      }
      const item = element("li"),
        link = element("a", heading.textContent ?? "");
      link.href = `#${encodeURIComponent(heading.id)}`;
      if (heading.tagName === "H3") item.dataset.rdSubheading = "true";
      item.append(link);
      list.append(item);
    }
    nav.append(list);
    this.replaceChildren(nav);
    this.dataset.ready = "true";
  }
}

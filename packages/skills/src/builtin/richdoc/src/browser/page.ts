import { element } from "./load.js";
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
      saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      /* Settings are optional when storage is unavailable. */
    }
    const panel = element("details");
    panel.dataset.rdControls = "true";
    const summary = element("summary", "Reader settings");
    panel.append(summary);
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
      select.value = value && values.includes(value) ? value : values[0];
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
    if (this.hasAttribute("title")) {
      const title = element("p", this.getAttribute("title")!);
      title.dataset.rdTitle = "true";
      this.prepend(title);
    }
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
    this.prepend(value, label);
    if (this.hasAttribute("delta")) {
      const delta = element("small", this.getAttribute("delta")!);
      delta.dataset.rdDelta = "true";
      this.append(delta);
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

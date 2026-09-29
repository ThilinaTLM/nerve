import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import {
  ELEMENTS,
  GLOBAL_ATTRIBUTES,
  LANGUAGES,
  parseChart,
  checkChart,
  VERSION,
} from "../schema/index.js";
import { contained, noSymlinks, hash, readManifest } from "../cli/files.js";
import { checkDiagram } from "../schema/diagram.js";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}
const NATIVE = new Set(
  "html head body title meta link script header main footer section article nav aside h1 h2 h3 h4 h5 h6 p ul ol li a strong em b i s del ins small mark sub sup br wbr span div code pre blockquote hr img table caption thead tbody tfoot tr th td dl dt dd details summary figure figcaption progress label input time abbr cite kbd samp address".split(
    " ",
  ),
);
const SOURCE = new Set(["rd-code", "rd-math", "rd-diagram", "rd-chart"]);
const tag = (n: Node): n is Element => "tagName" in n;
const attr = (n: Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value;
const children = (n: Node): Node[] => ("childNodes" in n ? n.childNodes : []);
const text = (n: Node): string =>
  "value" in n ? n.value : children(n).map(text).join("");

export async function validate(file: string, assetRoot: string) {
  const path = resolve(file),
    root = dirname(path);
  const diagnostics: Diagnostic[] = [];
  let total = 0,
    errors = 0,
    warnings = 0;
  function report(
    code: string,
    message: string,
    node?: Element,
    severity: Diagnostic["severity"] = "error",
    suggestion?: string,
  ) {
    total++;
    if (severity === "error") errors++;
    else warnings++;
    if (diagnostics.length >= 100) return;
    const location = node?.sourceCodeLocation;
    diagnostics.push({
      code,
      severity,
      message,
      ...(location
        ? { line: location.startLine, column: location.startCol }
        : {}),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  await noSymlinks(path);
  if ((await stat(path)).size > 5 * 1024 * 1024)
    throw new Error("Document exceeds 5 MiB.");
  const source = await readFile(path, "utf8");
  const document = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      report(
        "HTML_PARSE",
        `${error.code} at ${error.startLine}:${error.startCol}`,
      );
    },
  });
  const elements: Element[] = [];
  const walk = (node: Node) => {
    if (tag(node)) elements.push(node);
    for (const child of children(node)) walk(child);
  };
  walk(document);
  const find = (name: string) => elements.filter((n) => n.tagName === name);
  const html = find("html")[0],
    body = find("body")[0],
    pages = find("rd-page");
  if (!attr(html, "lang"))
    report("DOCUMENT_LANG", "Set a nonempty language on html.", html);
  for (const name of ["html", "head", "body"])
    if (!find(name)[0]?.sourceCodeLocation)
      report("DOCUMENT_STRUCTURE", `Write an explicit <${name}> element.`);
  if (!find("title").some((n) => text(n).trim()))
    report("DOCUMENT_TITLE", "Provide a nonempty title.");
  if (!find("meta").some((n) => attr(n, "charset")?.toLowerCase() === "utf-8"))
    report("DOCUMENT_CHARSET", "Add meta charset=utf-8.");
  if (
    !find("meta").some(
      (n) =>
        attr(n, "name") === "viewport" &&
        attr(n, "content")?.includes("width=device-width"),
    )
  )
    report("DOCUMENT_VIEWPORT", "Add a viewport meta tag.");
  if (pages.length !== 1 || pages[0].parentNode !== body)
    report("DOCUMENT_PAGE", "Use exactly one rd-page directly under body.");
  if (find("h1").length !== 1)
    report("DOCUMENT_HEADING", "Use one authored h1 document heading.", html);
  const ids = new Set<string>(),
    fragments: { value: string; node: Element }[] = [];
  const resources: { value: string; node: Element }[] = [];
  let heading = 0,
    scripts = 0,
    styles = 0;
  for (const node of elements) {
    const name = node.tagName;
    if (name.startsWith("rd-")) {
      const spec = ELEMENTS[name];
      if (!spec)
        report(
          "UNKNOWN_ELEMENT",
          `${name} is not supported. Use native semantic HTML where possible.`,
          node,
        );
      else {
        for (const [key, rule] of Object.entries(spec.attributes)) {
          const value = attr(node, key);
          if (rule.required && !value?.trim())
            report("REQUIRED_ATTRIBUTE", `${name} requires ${key}.`, node);
          if (
            value !== undefined &&
            rule.values &&
            !rule.values.includes(value)
          )
            report(
              "INVALID_ATTRIBUTE",
              `${name}.${key} must be ${rule.values.join(" | ")}.`,
              node,
            );
        }
        for (const { name: key } of node.attrs)
          if (
            !(key in spec.attributes) &&
            !GLOBAL_ATTRIBUTES.has(key) &&
            !key.startsWith("aria-") &&
            !key.startsWith("data-") &&
            key !== "style"
          )
            report(
              "UNKNOWN_ATTRIBUTE",
              `${name} does not support ${key}.`,
              node,
            );
      }
      const loc = node.sourceCodeLocation?.startTag;
      if (loc && /\/\s*>$/.test(source.slice(loc.startOffset, loc.endOffset)))
        report(
          "SELF_CLOSING_CUSTOM_ELEMENT",
          `Write an explicit closing tag for ${name}.`,
          node,
        );
      if (pages.length === 1 && node !== pages[0]) {
        let parent: Node | null = node.parentNode;
        while (parent && parent !== pages[0])
          parent = "parentNode" in parent ? parent.parentNode : null;
        if (!parent)
          report("OUTSIDE_PAGE", `${name} must be inside rd-page.`, node);
      }
    } else if (!NATIVE.has(name))
      report(
        "UNSUPPORTED_ELEMENT",
        `Unsupported native element: ${name}.`,
        node,
      );
    if (SOURCE.has(name)) {
      if (children(node).some(tag))
        report(
          "SOURCE_ESCAPING",
          `Escape <, > and & in ${name}; its content must be text, not nested HTML.`,
          node,
        );
      if (Buffer.byteLength(text(node)) > 256 * 1024)
        report(
          "SOURCE_LIMIT",
          `${name} exceeds the 256 KiB source limit.`,
          node,
        );
    }
    if (
      name === "rd-code" &&
      attr(node, "lang") &&
      !LANGUAGES.includes(attr(node, "lang") as (typeof LANGUAGES)[number])
    )
      report(
        "CODE_LANGUAGE",
        "Unsupported highlight language; plain text will be used.",
        node,
        "warning",
      );
    if (name === "rd-diagram") {
      try {
        checkDiagram(text(node));
      } catch (error) {
        report("DIAGRAM_RESOURCE", String(error), node);
      }
    }
    if (name === "rd-chart") {
      try {
        checkChart(
          parseChart(text(node), attr(node, "format")),
          attr(node, "x") ?? "",
          attr(node, "y") ?? "",
          attr(node, "kind"),
          attr(node, "series"),
        );
      } catch (error) {
        report("CHART_DATA", String(error), node);
      }
    }
    const id = attr(node, "id");
    if (id) {
      if (ids.has(id)) report("DUPLICATE_ID", `Duplicate id: ${id}`, node);
      ids.add(id);
    }
    if (/^h[1-6]$/.test(name)) {
      const level = Number(name[1]);
      if (level > heading + 1)
        report(
          "HEADING_ORDER",
          "Avoid skipping heading levels.",
          node,
          "warning",
        );
      heading = level;
    }
    for (const { name: key, value } of node.attrs) {
      if (key.startsWith("on") || key === "srcdoc")
        report(
          "EXECUTABLE_ATTRIBUTE",
          `Author-supplied ${key} is not allowed.`,
          node,
        );
      if (key === "style" && /url\s*\(|@import|expression\s*\(/i.test(value))
        report(
          "STYLE_RESOURCE",
          "Inline styles cannot introduce resources or executable expressions.",
          node,
        );
      if (key === "style")
        report(
          "CUSTOM_STYLE",
          "Prefer document components and native HTML over inline styling.",
          node,
          "warning",
        );
      if (
        ["href", "src", "action", "formaction"].includes(key) &&
        /^javascript:/i.test(
          Array.from(value)
            .filter((char) => char.charCodeAt(0) > 32)
            .join(""),
        )
      )
        report("UNSAFE_URL", "javascript URLs are not allowed.", node);
      if (["srcset", "ping", "background"].includes(key))
        report(
          "UNSUPPORTED_RESOURCE_ATTRIBUTE",
          `${key} is not supported; use a local src or ordinary link.`,
          node,
        );
    }
    if (name === "img" && attr(node, "alt") === undefined)
      report(
        "IMAGE_ALT",
        "Images require alt text (empty for decorative images).",
        node,
      );
    if (
      name === "progress" &&
      !attr(node, "aria-label") &&
      !attr(node, "aria-labelledby") &&
      !elements.some(
        (e) => e.tagName === "label" && id && attr(e, "for") === id,
      )
    )
      report(
        "PROGRESS_LABEL",
        "Label progress with a label or aria-label.",
        node,
      );
    if (name === "input" && attr(node, "type") !== "checkbox")
      report(
        "INPUT_TYPE",
        "Only native checklist checkboxes are supported.",
        node,
      );
    if (
      name === "input" &&
      !attr(node, "aria-label") &&
      !elements.some(
        (e) =>
          e.tagName === "label" &&
          ((id && attr(e, "for") === id) || node.parentNode === e),
      )
    )
      report("INPUT_LABEL", "Label checklist checkboxes.", node);
    if (name === "a" && attr(node, "href")?.startsWith("#"))
      fragments.push({ value: attr(node, "href")!.slice(1), node });
    if (name === "script") {
      scripts++;
      if (
        attr(node, "src") !== "./richdoc-assets/richdoc.js" ||
        text(node).trim() ||
        attr(node, "type") === "module"
      )
        report(
          "UNTRUSTED_SCRIPT",
          "Only ./richdoc-assets/richdoc.js is allowed; no inline/module scripts.",
          node,
        );
    }
    if (name === "meta" && attr(node, "http-equiv"))
      report(
        "META_HTTP_EQUIV",
        "Document redirects and policy overrides are not supported.",
        node,
      );
    if (name === "link") {
      if (
        attr(node, "rel") !== "stylesheet" ||
        attr(node, "href") !== "./richdoc-assets/richdoc.css"
      )
        report(
          "UNTRUSTED_STYLESHEET",
          "Only the packaged richdoc stylesheet is supported.",
          node,
        );
      else styles++;
    }
    if (name !== "a")
      for (const key of ["src", "href"])
        if (attr(node, key)) resources.push({ value: attr(node, key)!, node });
  }
  if (scripts !== 1 || styles !== 1)
    report(
      "DOCUMENT_ASSETS",
      "Link the packaged stylesheet and exactly one runtime script.",
    );
  for (const { value, node } of fragments) {
    try {
      if (value && !ids.has(decodeURIComponent(value)))
        report("BROKEN_FRAGMENT", `Missing fragment target: ${value}`, node);
    } catch {
      report("BROKEN_FRAGMENT", "Invalid fragment encoding.", node);
    }
  }
  if (resources.length > 256)
    report(
      "RESOURCE_LIMIT",
      "At most 256 local resource references may be checked.",
    );
  for (const { value, node } of resources.slice(0, 256)) {
    try {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(value) || /[?#]/.test(value))
        throw new Error("Resources must use simple local relative paths.");
      const target = resolve(root, decodeURIComponent(value));
      if (!contained(root, target))
        throw new Error("Resource escapes the document directory.");
      await noSymlinks(target);
      if (!(await stat(target)).isFile())
        throw new Error("Resource is not a regular file.");
    } catch (error) {
      report("LOCAL_RESOURCE", `${value}: ${String(error)}`, node);
    }
  }
  try {
    const installed = resolve(root, "richdoc-assets");
    await noSymlinks(installed);
    const expected = await readManifest(assetRoot);
    const actualPath = resolve(installed, "manifest.json");
    await noSymlinks(actualPath);
    if ((await stat(actualPath)).size > 1024 * 1024)
      throw new Error("Asset manifest is too large.");
    const actual = await readManifest(installed);
    if (
      actual.version !== VERSION ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    )
      throw new Error("Asset manifest differs; prepare assets again.");
    for (const [name, metadata] of Object.entries(expected.files)) {
      const target = resolve(installed, name);
      if (!contained(installed, target)) throw new Error("Invalid asset path.");
      await noSymlinks(target);
      if (
        (await stat(target)).size !== metadata.bytes ||
        hash(await readFile(target)) !== metadata.sha256
      )
        throw new Error(`Modified or missing asset: ${name}`);
    }
  } catch (error) {
    report("ASSET_INTEGRITY", String(error));
  }
  return {
    ok: errors === 0,
    path,
    errors,
    warnings,
    diagnostics,
    omitted: total - diagnostics.length,
    disclaimer: "Authoring validation is not a security sandbox.",
  };
}

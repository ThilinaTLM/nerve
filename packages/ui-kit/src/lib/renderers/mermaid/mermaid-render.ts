import { LruCache } from "@nervekit/ui-kit/collections/lru-cache";

export type MermaidTheme = {
  fingerprint: string;
  dark: boolean;
  fontFamily: string;
  background: string;
  foreground: string;
  card: string;
  surface: string;
  primary: string;
  border: string;
  strongBorder: string;
  mutedForeground: string;
};

export type MermaidRenderResult =
  | { ok: true; svg: string; themeFingerprint: string }
  | { ok: false; themeFingerprint: string };

const MERMAID_RENDER_CACHE_MAX = 100;
const renderCache = new LruCache<string, string>(MERMAID_RENDER_CACHE_MAX);
const renderInflight = new Map<string, Promise<string | undefined>>();
let renderSequence = 0;
let mountSequence = 0;
let renderQueue = Promise.resolve();

function cssColor(
  style: CSSStyleDeclaration,
  name: string,
  fallback: string,
  document: Document,
): string {
  const value = style.getPropertyValue(name).trim() || fallback;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHexColors(
  first: string,
  second: string,
  secondWeight: number,
): string {
  const channels = (value: string) =>
    [1, 3, 5].map((index) =>
      Number.parseInt(value.slice(index, index + 2), 16),
    );
  const firstChannels = channels(first);
  const secondChannels = channels(second);
  return `#${firstChannels
    .map((channel, index) =>
      Math.round(
        channel * (1 - secondWeight) + secondChannels[index]! * secondWeight,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function readMermaidTheme(element: Element): MermaidTheme {
  const document = element.ownerDocument;
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const dark = root.classList.contains("dark");
  const foreground = cssColor(style, "--foreground", "#000000", document);
  const card = cssColor(style, "--card", "#ffffff", document);
  const border = cssColor(style, "--border", "#808080", document);
  const theme = {
    dark,
    fontFamily: style.fontFamily || "sans-serif",
    background: cssColor(style, "--background", "#ffffff", document),
    foreground,
    card,
    surface: dark ? mixHexColors(card, foreground, 0.1) : card,
    primary: cssColor(style, "--primary", "#000000", document),
    border,
    strongBorder: dark ? mixHexColors(border, foreground, 0.3) : border,
    mutedForeground: cssColor(style, "--muted-foreground", "#808080", document),
  };
  return {
    ...theme,
    fingerprint: [
      root.dataset.theme ?? "",
      theme.dark ? "dark" : "light",
      theme.fontFamily,
      theme.background,
      theme.foreground,
      theme.card,
      theme.surface,
      theme.primary,
      theme.border,
      theme.strongBorder,
      theme.mutedForeground,
    ].join("\0"),
  };
}

export function isMermaidLanguage(language: string | undefined): boolean {
  return language?.trim().toLowerCase() === "mermaid";
}

async function sanitizeSvg(svg: string): Promise<string | undefined> {
  const { default: createDOMPurify } = await import("dompurify");
  const purifier = createDOMPurify(window);
  const sanitized = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: ["href", "xlink:href"],
  });
  const document = new DOMParser().parseFromString(sanitized, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.tagName !== "svg"
  )
    return undefined;
  return document.documentElement.outerHTML;
}

export function mermaidThemeVariables(theme: MermaidTheme) {
  return {
    background: theme.background,
    primaryColor: theme.surface,
    primaryTextColor: theme.foreground,
    primaryBorderColor: theme.strongBorder,
    secondaryColor: theme.background,
    secondaryTextColor: theme.foreground,
    secondaryBorderColor: theme.strongBorder,
    tertiaryColor: theme.surface,
    tertiaryTextColor: theme.foreground,
    tertiaryBorderColor: theme.strongBorder,
    lineColor: theme.mutedForeground,
    textColor: theme.foreground,
    mainBkg: theme.surface,
    nodeBorder: theme.strongBorder,
    clusterBkg: theme.background,
    clusterBorder: theme.strongBorder,
    titleColor: theme.foreground,
    edgeLabelBackground: theme.background,
    actorBkg: theme.surface,
    actorBorder: theme.strongBorder,
    actorTextColor: theme.foreground,
    actorLineColor: theme.strongBorder,
    signalColor: theme.foreground,
    signalTextColor: theme.foreground,
    labelBoxBkgColor: theme.background,
    labelBoxBorderColor: theme.strongBorder,
    labelTextColor: theme.foreground,
    loopTextColor: theme.foreground,
    activationBkgColor: theme.surface,
    activationBorderColor: theme.primary,
    noteBkgColor: theme.surface,
    noteBorderColor: theme.primary,
    noteTextColor: theme.foreground,
    sequenceNumberColor: theme.background,
    rowOdd: theme.card,
    rowEven: theme.background,
  };
}

async function renderWithTheme(
  source: string,
  theme: MermaidTheme,
): Promise<string | undefined> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "base",
    fontFamily: theme.fontFamily,
    themeVariables: mermaidThemeVariables(theme),
    flowchart: { htmlLabels: false },
  });
  const id = `nerve-mermaid-${++renderSequence}`;
  const { svg } = await mermaid.render(id, source);
  return sanitizeSvg(svg);
}

function renderCacheKey(source: string, theme: MermaidTheme): string {
  return `${theme.fingerprint}\0${source}`;
}

function renderCachedMermaid(
  source: string,
  theme: MermaidTheme,
): Promise<string | undefined> {
  const key = renderCacheKey(source, theme);
  const cached = renderCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = renderInflight.get(key);
  if (pending) return pending;

  const run = () => renderWithTheme(source, theme);
  const result = renderQueue.then(run, run);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  renderInflight.set(key, result);
  void result.then(
    (svg) => {
      if (svg) renderCache.set(key, svg);
      if (renderInflight.get(key) === result) renderInflight.delete(key);
    },
    () => {
      if (renderInflight.get(key) === result) renderInflight.delete(key);
    },
  );
  return result;
}

export async function renderMermaid(
  source: string,
  element: Element,
): Promise<MermaidRenderResult> {
  const theme = readMermaidTheme(element);
  try {
    const svg = await renderCachedMermaid(source, theme);
    return svg
      ? { ok: true, svg, themeFingerprint: theme.fingerprint }
      : { ok: false, themeFingerprint: theme.fingerprint };
  } catch {
    return { ok: false, themeFingerprint: theme.fingerprint };
  }
}

export function rewriteMermaidSvgIdReferences(
  value: string,
  ids: ReadonlyMap<string, string>,
): string {
  let rewritten = value;
  const entries = Array.from(ids).sort(
    ([first], [second]) => second.length - first.length,
  );
  for (const [original, scoped] of entries) {
    rewritten = rewritten.replaceAll(`#${original}`, `#${scoped}`);
  }
  return rewritten;
}

function rewriteIdList(
  value: string,
  ids: ReadonlyMap<string, string>,
): string {
  return value
    .split(/(\s+)/u)
    .map((part) => ids.get(part) ?? part)
    .join("");
}

function rewriteTimingReferences(
  value: string,
  ids: ReadonlyMap<string, string>,
): string {
  return value
    .split(";")
    .map((part) => {
      const match = part.match(/^(\s*)([^.]+)(\..*)$/u);
      if (!match) return part;
      const scoped = ids.get(match[2]!);
      return scoped ? `${match[1]}${scoped}${match[3]}` : part;
    })
    .join(";");
}

function scopeMermaidSvgIds(svg: SVGSVGElement): void {
  const prefix = `nerve-mermaid-mount-${++mountSequence}`;
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const ids = new Map<string, string>();
  for (const element of elements) {
    if (element.id) ids.set(element.id, `${prefix}-${element.id}`);
  }
  if (ids.size === 0) return;

  for (const element of elements) {
    const originalId = element.id;
    if (originalId) element.id = ids.get(originalId) ?? originalId;
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") continue;
      let value = rewriteMermaidSvgIdReferences(attribute.value, ids);
      if (
        attribute.name === "aria-labelledby" ||
        attribute.name === "aria-describedby"
      ) {
        value = rewriteIdList(value, ids);
      } else if (attribute.name === "begin" || attribute.name === "end") {
        value = rewriteTimingReferences(value, ids);
      }
      if (value !== attribute.value)
        element.setAttribute(attribute.name, value);
    }
  }
  for (const style of svg.querySelectorAll("style")) {
    if (style.textContent) {
      style.textContent = rewriteMermaidSvgIdReferences(style.textContent, ids);
    }
  }
}

export function mountMermaidSvg(host: HTMLElement, svg: string): boolean {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.tagName !== "svg"
  )
    return false;
  const parsedSvg = parsed.documentElement as unknown as SVGSVGElement;
  scopeMermaidSvgIds(parsedSvg);
  const mounted = host.ownerDocument.importNode(parsedSvg, true);
  mounted.setAttribute("role", "img");
  mounted.setAttribute(
    "aria-label",
    host.getAttribute("aria-label") ?? "Mermaid diagram",
  );
  host.replaceChildren(mounted);
  return true;
}

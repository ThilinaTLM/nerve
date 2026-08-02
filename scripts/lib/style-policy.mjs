/**
 * Pure helpers behind the CSS-architecture guards in
 * scripts/check-package-boundaries.mjs.
 *
 * The rules encode one idea: a class may be global only if it is (a) consumed
 * by two or more components AND (b) a deliberate cross-component contract.
 * Everything else belongs to the component that renders it.
 *
 * All helpers bias toward passing when the input is something the regexes do
 * not understand. A guard that produces false positives gets disabled.
 */

/** Global CSS partials that are allowed to exist. Adding one requires a review. */
export const ALLOWED_STYLE_PARTIALS = new Map([
  [
    "packages/workbench-app/src/styles/components",
    ["composer.css", "panel.css", "shell.css"],
  ],
  [
    "packages/ui-kit/src/styles/components",
    ["dialog.css", "popover.css", "terminal-output.css"],
  ],
]);

/**
 * Classes in the allowlisted partials that the single-consumer rule cannot
 * judge: either they are applied from somewhere a static scan cannot see, or
 * they only exist to express a rule that spans component boundaries. Every
 * entry names its reason.
 */
export const DYNAMIC_CLASS_ALLOWLIST = [
  // Half of `.panel-row-card .panel-row-hoverable:hover`, a parent/child rule
  // across PanelRowCard and PanelRow that Svelte scoping cannot express.
  /^panel-row-card$/,
  /^panel-row-hoverable$/,
  // Emitted by packages/ui-kit/src/lib/components/ui/dialog-shell/dialog-shell.svelte.
  /^dialog-/,
  // Emitted by packages/ui-kit/src/lib/components/ui/popover-panel/popover-panel.svelte.
  /^popover-/,
  // Generated from ANSI_COLOR_NAMES in packages/ui-kit/src/lib/core/terminal/ansi.ts.
  /^ansi-/,
  // Rendered by @xyflow/svelte.
  /^svelte-flow__/,
  // Rendered by the terminal HTML serializer in ui-kit's terminal core.
  /^terminal-output/,
  // Applied by paneforge / bits-ui through data attributes on the same element.
  /^sheet-pane$/,
];

/**
 * Bare `:global(...)` selectors that are allowed because they target a root
 * outside every component (the theme root, or a portalled dialog shell).
 */
export const GLOBAL_SELECTOR_ALLOWLIST = [
  // Theme root toggled on <html> by the theme store.
  /^\.dark\b/,
  // DialogShell portals its content; anchoring on `.dialog-content` keeps the
  // consumer rule ahead of the shared dialog defaults.
  /^\.dialog-content\./,
];

const CLASS_TOKEN = /-?[_a-zA-Z][\w-]*/;

/** Strips comments and at-rule preludes, then collects class selectors. */
export function extractClassSelectors(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set();
  for (const match of withoutComments.matchAll(
    new RegExp(`\\.(${CLASS_TOKEN.source})`, "g"),
  )) {
    classes.add(match[1]);
  }
  return [...classes].sort();
}

export function isDynamicClass(name) {
  return DYNAMIC_CLASS_ALLOWLIST.some((pattern) => pattern.test(name));
}

/**
 * Counts the component files that mention `name` as a whole class token.
 * Deliberately permissive: any whole-word occurrence counts, including inside
 * `cn()` arguments, `class:` directives and `triggerClass`/`viewportClass`
 * props, because over-counting only makes the guard quieter.
 */
export function countClassConsumers(name, files) {
  const pattern = new RegExp(`(^|[^\\w-])${escapeRegExp(name)}([^\\w-]|$)`);
  let count = 0;
  for (const [, text] of files) if (pattern.test(text)) count += 1;
  return count;
}

/**
 * Finds `:global(...)` selectors that are not anchored by a local class in the
 * same compound selector. Returns the offending selector bodies.
 */
export function findBareGlobalSelectors(svelteSource) {
  const offenders = [];
  for (const selector of styleRuleSelectors(svelteSource)) {
    if (!selector.startsWith(":global(")) continue;
    const body = readBalanced(selector.slice(":global".length));
    if (body === undefined) continue; // Unparseable: stay quiet.
    if (GLOBAL_SELECTOR_ALLOWLIST.some((pattern) => pattern.test(body)))
      continue;
    offenders.push(body);
  }
  return offenders;
}

/**
 * Yields every individual selector of every rule in a component's <style>
 * blocks, with whitespace collapsed. At-rule preludes and declaration bodies
 * are skipped.
 */
export function styleRuleSelectors(svelteSource) {
  const selectors = [];
  for (const [, css] of svelteSource.matchAll(
    /<style[^>]*>([\s\S]*?)<\/style>/g,
  )) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let prelude = "";
    let depth = 0;
    for (const char of withoutComments) {
      if (char === "{") {
        depth += 1;
        // Anything terminated by `{` is a selector list or an at-rule prelude,
        // at any nesting depth. Declarations are cleared at `;` and `}`.
        const trimmed = prelude.trim();
        if (trimmed && !trimmed.startsWith("@")) {
          for (const part of splitSelectorList(trimmed))
            selectors.push(part.replace(/\s+/g, " ").trim());
        }
        prelude = "";
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
        prelude = "";
      } else if (char === ";" && depth > 0) {
        prelude = "";
      } else {
        prelude += char;
      }
    }
  }
  return selectors;
}

function splitSelectorList(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function readBalanced(text) {
  if (!text.startsWith("(")) return undefined;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(1, index).trim();
    }
  }
  return undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Class names defined only in some *other* component's scoped <style> block.
 * Svelte scoping means such a name does nothing where it is written: this is
 * the "copied class name" defect, and it is invisible to svelte-check.
 *
 * Names that are defined nowhere at all are ignored on purpose — those are
 * Tailwind utilities, test hooks and query selectors.
 *
 * @param {Map<string, string>} svelteFiles component path -> source
 * @param {Set<string>} globalClasses classes declared by global CSS
 * @returns {Array<{ file: string, className: string, definedIn: string[] }>}
 */
export function findInertClassNames(svelteFiles, globalClasses) {
  const scopedDefinitions = new Map();
  for (const [file, source] of svelteFiles) {
    for (const selector of styleRuleSelectors(source)) {
      for (const className of extractClassSelectors(stripGlobals(selector))) {
        if (!scopedDefinitions.has(className))
          scopedDefinitions.set(className, new Set());
        scopedDefinitions.get(className).add(file);
      }
    }
  }

  const offenders = [];
  for (const [file, source] of svelteFiles) {
    for (const className of markupClassNames(source)) {
      if (globalClasses.has(className)) continue;
      const owners = scopedDefinitions.get(className);
      if (!owners || owners.size === 0 || owners.has(file)) continue;
      offenders.push({ file, className, definedIn: [...owners].sort() });
    }
  }
  return offenders;
}

function stripGlobals(selector) {
  let result = selector;
  let previous;
  do {
    previous = result;
    result = result.replace(/:global\(([^()]*)\)/g, " ");
  } while (result !== previous);
  return result;
}

/** Class tokens written in a component's markup. */
export function markupClassNames(svelteSource) {
  const names = new Set();
  for (const markup of markupSegments(svelteSource)) {
    for (const match of markup.matchAll(/\bclass:([\w-]+)/g)) {
      names.add(match[1]);
    }
    for (const match of markup.matchAll(/\bclass=(?:"([^"]*)"|'([^']*)')/g)) {
      for (const token of (match[1] ?? match[2]).split(/\s+/)) {
        if (/^[a-z][\w-]*$/i.test(token)) names.add(token);
      }
    }
  }
  // `class={...}` expressions are skipped: their string literals are just as
  // likely to be comparison operands as class names, and a false positive here
  // would get the whole guard turned off.
  return [...names].sort();
}

/**
 * Returns markup around style blocks without concatenating the surrounding
 * text. Keeping each range separate prevents removed text from synthesizing a
 * new tag or class attribute at the join.
 */
function markupSegments(svelteSource) {
  const segments = [];
  const styleBlocks = /<style[^>]*>[\s\S]*?<\/style>/g;
  let cursor = 0;
  for (const match of svelteSource.matchAll(styleBlocks)) {
    segments.push(svelteSource.slice(cursor, match.index));
    cursor = match.index + match[0].length;
  }
  segments.push(svelteSource.slice(cursor));
  return segments;
}

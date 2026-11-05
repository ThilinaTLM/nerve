import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState, Prec } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import { codeFoldMarker } from "./code-fold-marker";
import {
  overviewMarkSource,
  overviewRuler,
  searchOverviewMarks,
} from "./code-overview-ruler";
import { tags } from "@lezer/highlight";

export type CodeLanguageId =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "jsonc"
  | "css"
  | "html"
  | "svelte"
  | "markdown"
  | "python"
  | "yaml"
  | "bash"
  | "shellscript"
  | "toml"
  | "java"
  | "cpp"
  | "xml"
  | "rust"
  | "sass"
  | "scss"
  | "go"
  | "php"
  | "sql"
  | "vue"
  | "less"
  | "angular"
  | "liquid"
  | "wast";

const extensionLanguages: Record<string, CodeLanguageId> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  html: "html",
  htm: "html",
  svelte: "svelte",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "shellscript",
  toml: "toml",
  java: "java",
  c: "cpp",
  h: "cpp",
  ino: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  "h++": "cpp",
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  xsd: "xml",
  xhtml: "xml",
  svg: "xml",
  rs: "rust",
  sass: "sass",
  scss: "scss",
  go: "go",
  php: "php",
  php3: "php",
  php4: "php",
  php5: "php",
  php7: "php",
  php8: "php",
  phtml: "php",
  phps: "php",
  sql: "sql",
  vue: "vue",
  less: "less",
  angular: "angular",
  liquid: "liquid",
  wat: "wast",
  wast: "wast",
};

function filenameLanguage(base: string): CodeLanguageId | undefined {
  if (/\.component\.html$/i.test(base)) return "angular";
  if (/^\.env(?:\..+)?$/i.test(base)) return "shellscript";
  return undefined;
}

const languageIds = new Set<CodeLanguageId>(Object.values(extensionLanguages));
const languageCache = new Map<CodeLanguageId, Promise<Extension>>();
const resolvedLanguages = new Map<CodeLanguageId, Extension>();

export function codeLanguageId(
  value: string | undefined,
): CodeLanguageId | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (languageIds.has(normalized as CodeLanguageId)) {
    return normalized as CodeLanguageId;
  }
  const base = normalized.split(/[\\/]/).pop() ?? normalized;
  const byFilename = filenameLanguage(base);
  if (byFilename) return byFilename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? extensionLanguages[base.slice(dot + 1)] : undefined;
}

export function codeDocumentLineSeparator(text: string): string | undefined {
  return text.match(/\r\n|\n|\r/)?.[0];
}

export function localLineNumber(
  externalLine: number | undefined,
  lineStart: number,
  lineCount: number,
): number | undefined {
  if (externalLine === undefined) return undefined;
  const local = externalLine - lineStart + 1;
  return local >= 1 && local <= lineCount ? local : undefined;
}

export function loadCodeLanguage(
  value: string | undefined,
): Promise<Extension> {
  const id = codeLanguageId(value);
  if (!id) return Promise.resolve([]);
  const cached = languageCache.get(id);
  if (cached) return cached;

  const pending = loadLanguage(id).then((extension) => {
    resolvedLanguages.set(id, extension);
    return extension;
  });
  languageCache.set(id, pending);
  return pending;
}

/** The language extension when it has already loaded, so a view can mount
 * highlighted instead of repainting once the parser arrives. */
export function loadedCodeLanguage(
  value: string | undefined,
): Extension | undefined {
  const id = codeLanguageId(value);
  return id ? resolvedLanguages.get(id) : undefined;
}

async function loadLanguage(id: CodeLanguageId): Promise<Extension> {
  switch (id) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({
        typescript: id === "typescript" || id === "tsx",
        jsx: id === "jsx" || id === "tsx",
      });
    }
    case "json":
    case "jsonc": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "svelte": {
      const { svelte } = await import("@replit/codemirror-lang-svelte");
      return svelte();
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "toml": {
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return StreamLanguage.define(
        toml as unknown as Parameters<typeof StreamLanguage.define>[0],
      );
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    case "cpp": {
      const { cpp } = await import("@codemirror/lang-cpp");
      return cpp();
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml");
      return xml();
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "sass":
    case "scss": {
      const { sass } = await import("@codemirror/lang-sass");
      return sass({ indented: id === "sass" });
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "php": {
      const { php } = await import("@codemirror/lang-php");
      return php();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "vue": {
      const { vue } = await import("@codemirror/lang-vue");
      return vue();
    }
    case "less": {
      const { less } = await import("@codemirror/lang-less");
      return less();
    }
    case "angular": {
      const { angular } = await import("@codemirror/lang-angular");
      return angular();
    }
    case "liquid": {
      const { liquid } = await import("@codemirror/lang-liquid");
      return liquid();
    }
    case "wast": {
      const { wast } = await import("@codemirror/lang-wast");
      return wast();
    }
    case "bash":
    case "shellscript": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      // legacy-modes may resolve a patch-newer language package; its parser
      // contract remains structurally compatible across those patch versions.
      return StreamLanguage.define(
        shell as unknown as Parameters<typeof StreamLanguage.define>[0],
      );
    }
  }
}

/* The editor paints from the same `--syntax-*` role tokens the transcript's
 * Shiki theme uses, so a snippet keeps its colours when it moves between the
 * two surfaces. Semantic tokens are deliberately absent: `--success` and
 * `--destructive` mean added/removed and error elsewhere in the app, including
 * in the diff views rendered right next to code. */
const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
    ],
    color: "var(--syntax-keyword)",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: "var(--syntax-property)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.character],
    color: "var(--syntax-string)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.regexp, tags.escape],
    color: "var(--syntax-number)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: "var(--syntax-type)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-function)",
  },
  {
    tag: [
      tags.variableName,
      tags.labelName,
      tags.definition(tags.variableName),
    ],
    color: "var(--syntax-variable)",
  },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.operator,
      tags.derefOperator,
      tags.meta,
    ],
    color: "var(--syntax-punctuation)",
  },
  { tag: tags.inserted, color: "var(--syntax-added)" },
  { tag: [tags.deleted, tags.invalid], color: "var(--syntax-removed)" },
  { tag: tags.changed, color: "var(--syntax-changed)" },
  { tag: tags.heading, color: "var(--syntax-keyword)", fontWeight: "500" },
  {
    tag: [tags.link, tags.url],
    color: "var(--syntax-link)",
    textDecoration: "underline",
  },
  { tag: tags.strong, fontWeight: "500" },
  { tag: tags.emphasis, fontStyle: "italic" },
]);

/* One font size and line height for the content and every gutter, so line
 * numbers, change markers and fold chevrons share the text's baseline. */
export const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minWidth: "100%",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
    fontSize: "var(--text-ui)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.25rem",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "calc(var(--spacing) * 2) 0",
    caretColor: "var(--primary)",
  },
  "&.cm-editable .cm-content": { cursor: "text" },
  ".cm-line": {
    padding: "0 calc(var(--spacing) * 4) 0 calc(var(--spacing) * 2)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    border: "none",
    borderRight:
      "1px solid color-mix(in oklab, var(--background) 55%, var(--border))",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3ch",
    padding: "0 calc(var(--spacing) * 1) 0 calc(var(--spacing) * 3)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&:not(.cm-focused) .cm-activeLineGutter": {
    color: "inherit",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)",
  },
  "&:not(.cm-focused) .cm-activeLine": { backgroundColor: "transparent" },
  ".cm-foldGutter .cm-gutterElement": {
    color: "var(--muted-foreground)",
    padding: "0 calc(var(--spacing) * 0.5)",
  },
  ".cm-fold-marker": {
    alignItems: "center",
    display: "inline-flex",
    height: "100%",
    justifyContent: "center",
    width: "calc(var(--spacing) * 4)",
    cursor: "pointer",
    transition: "opacity 120ms ease-out",
  },
  // Open-fold chevrons only show while the gutter is hovered or on the
  // cursor line; folded ranges keep their marker so collapsed code is visible.
  ".cm-fold-marker[data-open='true']": { opacity: "0" },
  ".cm-gutters:hover .cm-fold-marker, &.cm-focused .cm-activeLineGutter .cm-fold-marker":
    { opacity: "1" },
  ".cm-foldPlaceholder": {
    color: "var(--muted-foreground)",
    backgroundColor: "var(--muted)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "0 calc(var(--spacing) * 1)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "2px solid var(--primary)",
  },
  ".cm-selectionBackground": {
    backgroundColor:
      "color-mix(in oklab, var(--background) 86%, var(--primary)) !important",
  },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor:
      "color-mix(in oklab, var(--background) 76%, var(--primary)) !important",
  },
  ".cm-selectionMatch": {
    backgroundColor:
      "color-mix(in oklab, var(--background) 82%, var(--info)) !important",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline:
      "1px solid color-mix(in oklab, var(--foreground) 35%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch": {
    backgroundColor:
      "color-mix(in oklab, var(--background) 65%, var(--warning)) !important",
    borderRadius: "var(--radius-sm)",
    boxShadow: "inset 0 -1px 0 var(--warning)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor:
      "color-mix(in oklab, var(--background) 52%, var(--primary)) !important",
    boxShadow: "inset 0 0 0 1px var(--primary)",
  },
  ".cm-target-line": {
    backgroundColor: "color-mix(in oklab, var(--warning) 18%, transparent)",
    boxShadow:
      "inset 0.2rem 0 0 color-mix(in oklab, var(--warning) 72%, transparent)",
  },
  ".cm-panels": {
    color: "var(--foreground)",
    backgroundColor: "var(--card)",
  },
});

export type CodeSurfaceOptions = {
  ariaLabel: string;
  editable?: boolean;
  lineStart?: number;
  highlightSelectionMatches?: boolean;
  /** Off for views that don't scroll themselves (split diff sides). */
  scrollPastEnd?: boolean;
  /** Off for the original side of a split diff; the modified side owns it. */
  overviewRuler?: boolean;
};

/** Base extensions shared by every code view. Editing adds history, bracket
 * closing, auto-indent and the editing keymaps; it never adds completion. */
export function codeSurfaceExtensions(input: CodeSurfaceOptions): Extension[] {
  const lineStart = input.lineStart ?? 1;
  const editable = input.editable ?? false;
  return [
    editable
      ? [
          history(),
          closeBrackets(),
          indentOnInput(),
          dropCursor(),
          EditorView.editorAttributes.of({ class: "cm-editable" }),
          keymap.of([
            ...closeBracketsKeymap,
            { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
            { key: "Mod-Shift-l", run: selectSelectionMatches },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
        ]
      : [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          keymap.of(defaultKeymap),
        ],
    EditorView.contentAttributes.of({
      "aria-label": input.ariaLabel,
      ...(editable ? { "aria-keyshortcuts": "Control+S Meta+S" } : {}),
      tabindex: "0",
    }),
    // Gutter order: line numbers, change markers (default precedence), folds.
    Prec.high(
      lineNumbers({ formatNumber: (line) => String(lineStart + line - 1) }),
    ),
    Prec.lowest(foldGutter({ markerDOM: codeFoldMarker })),
    codeFolding(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    input.scrollPastEnd === false ? [] : scrollPastEnd(),
    EditorView.cursorScrollMargin.of({ x: 32, y: 60 }),
    search(),
    input.overviewRuler === false ? [] : overviewRuler,
    overviewMarkSource.of(searchOverviewMarks),
    input.highlightSelectionMatches ? highlightSelectionMatches() : [],
    syntaxHighlighting(codeHighlightStyle),
    keymap.of(foldKeymap),
    codeMirrorTheme,
  ];
}

const languageLabels: Record<CodeLanguageId, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JavaScript JSX",
  tsx: "TypeScript JSX",
  json: "JSON",
  jsonc: "JSON with Comments",
  css: "CSS",
  html: "HTML",
  svelte: "Svelte",
  markdown: "Markdown",
  python: "Python",
  yaml: "YAML",
  bash: "Shell",
  shellscript: "Shell",
  toml: "TOML",
  java: "Java",
  cpp: "C/C++",
  xml: "XML",
  rust: "Rust",
  sass: "Sass",
  scss: "SCSS",
  go: "Go",
  php: "PHP",
  sql: "SQL",
  vue: "Vue",
  less: "Less",
  angular: "Angular",
  liquid: "Liquid",
  wast: "WebAssembly Text",
};

export function codeLanguageLabel(value: string | undefined): string {
  const id = codeLanguageId(value);
  return id ? languageLabels[id] : "Plain text";
}

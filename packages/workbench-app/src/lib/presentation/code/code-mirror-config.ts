import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { highlightSelectionMatches, search } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { showMinimap } from "@replit/codemirror-minimap";

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

export function localLineNumber(
  externalLine: number | undefined,
  lineStart: number,
  lineCount: number,
): number | undefined {
  if (externalLine === undefined) return undefined;
  const local = externalLine - lineStart + 1;
  return local >= 1 && local <= lineCount ? local : undefined;
}

export async function loadCodeLanguage(
  value: string | undefined,
): Promise<Extension> {
  const id = codeLanguageId(value);
  if (!id) return [];
  const cached = languageCache.get(id);
  if (cached) return cached;

  const pending = loadLanguage(id);
  languageCache.set(id, pending);
  return pending;
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

const codeHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: "var(--primary)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--primary)" },
  { tag: [tags.string, tags.inserted], color: "var(--success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--info)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted-foreground)" },
  { tag: [tags.typeName, tags.className], color: "var(--warning)" },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "var(--foreground)",
  },
  { tag: [tags.deleted, tags.invalid], color: "var(--destructive)" },
  { tag: tags.heading, color: "var(--primary)", fontWeight: "600" },
  { tag: tags.link, color: "var(--info)", textDecoration: "underline" },
]);

export const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minWidth: "100%",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
    fontSize: "var(--text-sm)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "calc(var(--spacing) * 2) 0",
    caretColor: "var(--primary)",
  },
  ".cm-line": {
    padding: "0 calc(var(--spacing) * 4) 0 calc(var(--spacing) * 2)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight:
      "1px solid color-mix(in oklab, var(--background) 55%, var(--border))",
  },
  ".cm-lineNumbers": {
    fontSize: "var(--text-xs)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 calc(var(--spacing) * 1) 0 calc(var(--spacing) * 2)",
  },
  ".cm-foldGutter .cm-gutterElement": {
    color: "var(--muted-foreground)",
    padding: "0",
  },
  ".cm-fold-marker": {
    alignItems: "center",
    display: "inline-flex",
    height: "100%",
    justifyContent: "center",
    width: "calc(var(--spacing) * 4)",
  },
  ".cm-foldPlaceholder": {
    color: "var(--muted-foreground)",
    backgroundColor: "var(--muted)",
    border: "1px solid var(--border)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor:
        "color-mix(in oklab, var(--background) 78%, var(--primary)) !important",
    },
  ".cm-activeLine": { backgroundColor: "transparent" },
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
  ".cm-minimap-gutter": {
    backgroundColor: "var(--background)",
    borderLeft: "1px solid var(--border)",
  },
  ".cm-minimap-overlay": {
    backgroundColor: "var(--primary)",
  },
  ".cm-minimap-box-shadow": {
    boxShadow: "none",
  },
});

function codeMinimapExtension(): Extension {
  return showMinimap.of({
    create: () => {
      const dom = document.createElement("div");
      dom.setAttribute("aria-label", "Code minimap");
      dom.title = "Code minimap";
      return { dom };
    },
    displayText: "blocks",
    showOverlay: "always",
  });
}

export function editableCodeExtensions(ariaLabel: string): Extension[] {
  return [
    history(),
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    bracketMatching(),
    syntaxHighlighting(codeHighlightStyle),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
    codeMirrorTheme,
  ];
}

export function readOnlyCodeExtensions(input: {
  lineStart?: number;
  ariaLabel: string;
  highlightSelectionMatches?: boolean;
  foldMarkerDOM?: (open: boolean) => HTMLElement;
}): Extension[] {
  const lineStart = input.lineStart ?? 1;
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({
      "aria-label": input.ariaLabel,
      tabindex: "0",
    }),
    lineNumbers({ formatNumber: (line) => String(lineStart + line - 1) }),
    foldGutter({ markerDOM: input.foldMarkerDOM }),
    codeFolding(),
    bracketMatching(),
    highlightSpecialChars(),
    drawSelection(),
    search(),
    input.highlightSelectionMatches ? highlightSelectionMatches() : [],
    syntaxHighlighting(codeHighlightStyle),
    keymap.of(foldKeymap),
    codeMinimapExtension(),
    codeMirrorTheme,
  ];
}

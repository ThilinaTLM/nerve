/**
 * The single Shiki theme Nerve highlights with.
 *
 * Rather than shipping one bundled TextMate theme per colour theme, every token
 * colour is a `--syntax-*` CSS variable that `theme.css` redefines per theme and
 * colour mode. Shiki emits those variables verbatim into inline styles, so a
 * theme or light/dark switch is a pure CSS repaint: no re-tokenization, no
 * per-theme cache keys, and the CodeMirror editor can read the same variables
 * and land on exactly the same colours.
 *
 * The scope list is deliberately richer than the token role count. Ten roles
 * keep the palette designable; mapping many scopes onto them keeps the output
 * from collapsing into keyword/string/plain the way a minimal theme does.
 */

type TokenColor = {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
};

export type SyntaxThemeRegistration = {
  name: string;
  type: "dark";
  colors: Record<string, string>;
  tokenColors: TokenColor[];
};

/** Role tokens the theme paints with; `theme.css` must define each one. */
export const SYNTAX_TOKEN_ROLES = [
  "plain",
  "variable",
  "punctuation",
  "comment",
  "keyword",
  "string",
  "number",
  "function",
  "type",
  "property",
  "added",
  "removed",
  "changed",
  "link",
] as const;

export type SyntaxTokenRole = (typeof SYNTAX_TOKEN_ROLES)[number];

function role(name: SyntaxTokenRole): string {
  return `var(--syntax-${name})`;
}

export const SYNTAX_THEME_NAME = "nerve-syntax";

export const syntaxTheme: SyntaxThemeRegistration = {
  name: SYNTAX_THEME_NAME,
  type: "dark",
  colors: {
    "editor.foreground": role("plain"),
    // The surrounding code-block surface owns the background; a painted one here
    // would fight the `well`/`card` ladder the block is embedded in.
    "editor.background": "transparent",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: role("comment"), fontStyle: "italic" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.control",
        "keyword.operator.expression",
        "keyword.operator.new",
        "keyword.operator.logical",
        "variable.language.this",
        "variable.language.super",
        "markup.heading",
        "entity.name.tag.yaml",
      ],
      settings: { foreground: role("keyword") },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "constant.character",
        "constant.other.symbol",
        "punctuation.definition.string",
        "markup.inline.raw",
        "markup.raw.block",
      ],
      settings: { foreground: role("string") },
    },
    {
      scope: [
        "string.regexp",
        "constant.character.escape",
        "constant.other.character-class",
      ],
      settings: { foreground: role("number") },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.language.boolean",
        "constant.language.null",
        "constant.language.undefined",
        "constant.other",
        "support.constant",
      ],
      settings: { foreground: role("number") },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "entity.name.function.member",
        "variable.function",
      ],
      settings: { foreground: role("function") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
        "entity.name.tag",
        "entity.name.tag.html",
        "meta.type.annotation",
      ],
      settings: { foreground: role("type") },
    },
    {
      scope: [
        "variable.other.property",
        "variable.other.object.property",
        "meta.object-literal.key",
        "support.type.property-name",
        "entity.other.attribute-name",
        "meta.attribute",
        "meta.tag.attribute",
      ],
      settings: { foreground: role("property") },
    },
    {
      scope: [
        "variable",
        "variable.other",
        "variable.parameter",
        "meta.definition.variable",
        "support.variable",
      ],
      settings: { foreground: role("variable") },
    },
    {
      scope: [
        "punctuation",
        "punctuation.separator",
        "punctuation.terminator",
        "punctuation.accessor",
        "punctuation.definition.tag",
        "meta.brace",
        "keyword.operator",
        "keyword.operator.assignment",
        "keyword.operator.arithmetic",
        "keyword.operator.comparison",
        "keyword.operator.accessor",
        "meta.template.expression",
      ],
      settings: { foreground: role("punctuation") },
    },
    {
      scope: ["markup.inserted", "meta.diff.header.to-file"],
      settings: { foreground: role("added") },
    },
    {
      scope: ["markup.deleted", "meta.diff.header.from-file"],
      settings: { foreground: role("removed") },
    },
    {
      scope: ["markup.changed", "meta.diff.range", "meta.diff.header"],
      settings: { foreground: role("changed") },
    },
    {
      scope: ["invalid", "invalid.illegal"],
      settings: { foreground: role("removed") },
    },
    {
      scope: [
        "markup.underline.link",
        "string.other.link",
        "meta.link.inline.markdown",
      ],
      settings: { foreground: role("link") },
    },
    { scope: ["markup.bold", "strong"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic", "emphasis"], settings: { fontStyle: "italic" } },
  ],
};

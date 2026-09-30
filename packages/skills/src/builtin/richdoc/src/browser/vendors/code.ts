import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import javascript from "@shikijs/langs/javascript";
import typescript from "@shikijs/langs/typescript";
import json from "@shikijs/langs/json";
import python from "@shikijs/langs/python";
import bash from "@shikijs/langs/bash";
import sql from "@shikijs/langs/sql";
import html from "@shikijs/langs/html";
import css from "@shikijs/langs/css";
import markdown from "@shikijs/langs/markdown";
import diff from "@shikijs/langs/diff";
const ready = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [
    {
      name: "richdoc",
      type: "dark",
      settings: [
        { scope: ["keyword", "storage"], settings: { foreground: "#A78BFA" } },
        { scope: ["string"], settings: { foreground: "#86EFAC" } },
        { scope: ["comment"], settings: { foreground: "#94A3B8" } },
        { scope: ["constant.numeric"], settings: { foreground: "#FBBF24" } },
      ],
    },
  ],
  langs: [
    javascript,
    typescript,
    json,
    python,
    bash,
    sql,
    html,
    css,
    markdown,
    diff,
  ],
});
export async function render(source: string, language: string) {
  const highlighter = await ready;
  const lang = highlighter.getLoadedLanguages().includes(language)
    ? language
    : "text";
  const tones: Record<string, string> = {
    "#A78BFA": "keyword",
    "#86EFAC": "string",
    "#94A3B8": "comment",
    "#FBBF24": "number",
  };
  const escape = (text: string) =>
    text.replace(
      /[&<>]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!,
    );
  const { tokens } = highlighter.codeToTokens(source, {
    lang,
    theme: "richdoc",
  });
  // Only escaped source and our fixed token categories become markup. Colours
  // come from document tokens, so reader theme changes also update code blocks.
  return `<pre><code>${tokens
    .map((line) =>
      line
        .map((token) => {
          const tone = tones[token.color?.toUpperCase() ?? ""];
          return tone
            ? `<span data-rd-token="${tone}">${escape(token.content)}</span>`
            : escape(token.content);
        })
        .join(""),
    )
    .join("\n")}</code></pre>`;
}

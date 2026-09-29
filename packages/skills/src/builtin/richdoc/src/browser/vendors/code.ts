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
import DOMPurify from "dompurify";
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
  return DOMPurify.sanitize(
    highlighter.codeToHtml(source, { lang, theme: "richdoc" }),
  );
}

import katex from "katex";
export function render(source: string, display: boolean) {
  return katex.renderToString(source, {
    displayMode: display,
    throwOnError: true,
    trust: false,
    strict: "error",
    maxExpand: 1000,
    maxSize: 20,
    output: "htmlAndMathml",
  });
}

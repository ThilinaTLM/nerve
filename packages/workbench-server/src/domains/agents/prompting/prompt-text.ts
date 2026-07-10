/**
 * Format readable multiline prompt template literals.
 *
 * The tag strips the common source indentation and trims leading/trailing blank
 * lines, so prompt bodies can be indented naturally in TypeScript source without
 * leaking that indentation into model-visible text.
 */
export function promptText(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let text = "";

  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];
    if (index >= values.length) continue;

    const indent = currentLineIndent(text);
    text += indentMultilineValue(values[index], indent);
  }

  return dedentText(text);
}

function indentMultilineValue(value: unknown, indent: string): string {
  const text = normalizeLineEndings(value == null ? "" : String(value));
  if (!indent) return text;
  return text.replace(/\n/g, `\n${indent}`);
}

function currentLineIndent(text: string): string {
  const lineStart = text.lastIndexOf("\n") + 1;
  const currentLine = text.slice(lineStart);
  return currentLine.match(/^[\t ]*/)?.[0] ?? "";
}

function dedentText(value: string): string {
  const lines = normalizeLineEndings(value).split("\n");

  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map((line) => (line.trim() === "" ? "" : line.slice(commonIndent)))
    .join("\n");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

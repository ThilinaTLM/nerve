import { tokenize, type Token } from "./script-tokenizer.js";

/**
 * Makes the value of a script's last expression its result, as a REPL does:
 * `jira.issues.get("X")` alone prints the issue. The last statement is found
 * without a parser, so the rewrite is conservative: it happens only where the
 * statement boundary is certain, and a rewrite that does not compile is
 * discarded by the caller (see `executeQuickScript`), which runs the script as
 * written. Nothing is rewritten when the last statement is not an expression.
 */

/** Words that start a statement which is not an expression. */
const STATEMENT_WORDS = new Set([
  "const",
  "let",
  "var",
  "using",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "try",
  "catch",
  "finally",
  "throw",
  "return",
  "break",
  "continue",
  "function",
  "class",
  "import",
  "export",
  "enum",
  "debugger",
  "with",
]);
/** Statement words only before a name (`type A = ...`); otherwise ordinary identifiers (`type.id`). */
const CONTEXTUAL_WORDS = new Set([
  "type",
  "interface",
  "declare",
  "namespace",
  "module",
  "abstract",
  "async",
]);
/** A line that starts with one of these continues the expression before it. */
const CONTINUES = new Set(["in", "of", "instanceof", "as", "satisfies"]);
/** A line break after one of these does not end the statement. */
const EXPECTS_MORE = new Set([
  ...CONTINUES,
  "typeof",
  "await",
  "new",
  "void",
  "delete",
  "yield",
  "else",
  "do",
  "try",
  "finally",
  "const",
  "let",
  "var",
  "using",
  "throw",
  "case",
  "extends",
  "import",
  "export",
  "default",
  "async",
  "function",
  "class",
  "return",
]);
/** `if (...)`, `for (...)`: the statement after the `)` is the body, not a new statement. */
const HEADERS = new Set(["if", "for", "while", "with", "switch", "catch"]);

const isPunct = (token: Token | undefined, text: string) =>
  token?.kind === "punct" && token.text === text;

type Span = { start: number; end: number };

function lastExpression(
  code: string,
  slashAfterCloser: "division" | "regex",
): Span | undefined {
  const tokens = tokenize(code, slashAfterCloser);
  // Depth before each token, and the `)` tokens that close a control header.
  const depths: number[] = [];
  const headerClose = new Set<number>();
  const opens: number[] = [];
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    // A closing bracket still belongs to what it closes.
    depths.push(depth);
    if (token.kind !== "punct") continue;
    if (/^(?:[([{]|\$\{)$/.test(token.text)) {
      depth += 1;
      opens.push(index);
    } else if (/^[)\]}]$/.test(token.text)) {
      depth -= 1;
      const open = opens.pop();
      if (open === undefined) return undefined;
      const before = tokens[open - 1];
      const word = before?.kind === "id" ? before.text : "";
      if (
        token.text === ")" &&
        (HEADERS.has(word) ||
          (word === "await" && tokens[open - 2]?.text === "for"))
      )
        headerClose.add(index);
    }
  }
  if (depth !== 0) return undefined;

  let last = tokens.length - 1;
  while (last >= 0 && depths[last] === 0 && isPunct(tokens[last], ";"))
    last -= 1;
  if (last < 0) return undefined;

  /** Whether a statement certainly starts at token `index`. */
  const startsStatement = (index: number): boolean => {
    if (depths[index] !== 0) return false;
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (isPunct(previous, ";")) return true;
    if (!code.slice(previous.end, token.start).includes("\n")) return false;
    // Without a semicolon the line break ends the statement only when neither side can continue.
    if (token.kind === "punct" || token.kind === "regex") return false;
    if (code[token.start] === "`") return false;
    if (token.kind === "id" && CONTINUES.has(token.text)) return false;
    if (previous.kind === "id") return !EXPECTS_MORE.has(previous.text);
    if (previous.kind !== "punct") return true;
    if (previous.text === ")") return !headerClose.has(index - 1);
    return previous.text === "]" || previous.text === "}";
  };
  let first = last;
  while (first > 0 && !startsStatement(first)) first -= 1;

  const head = tokens[first];
  if (head.kind === "punct" && (head.text === "{" || head.text === "@"))
    return undefined;
  if (head.kind === "id") {
    if (STATEMENT_WORDS.has(head.text)) return undefined;
    const next = tokens[first + 1];
    if (CONTEXTUAL_WORDS.has(head.text) && next?.kind === "id" && first < last)
      return undefined;
    // A label.
    if (isPunct(next, ":") && first + 1 <= last) return undefined;
  }
  return { start: head.start, end: tokens[last].end };
}

/** The script with its last expression returned; the script itself when there is none or it is not certain. */
export function resultExpression(code: string): string {
  // A `/` after `)` or `}` can divide or start a regular expression; both readings must agree.
  const span = lastExpression(code, "division");
  const other = lastExpression(code, "regex");
  if (!span || span.start !== other?.start || span.end !== other.end)
    return code;
  return `${code.slice(0, span.start)}return (${code.slice(span.start, span.end)})${code.slice(span.end)}`;
}

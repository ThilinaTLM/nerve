/** Identifier characters, including `\\uXXXX` / `\\u{X}` escapes, which name the same identifier as the plain letters. */
const IDENTIFIER =
  /(?:[\p{ID_Continue}$\u200c\u200d]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})+/uy;
const IDENTIFIER_START = /[\p{ID_Start}$_]/u;
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/** Decodes the escape at `source[at]` (a backslash): its text and the index after it. */
function readEscape(source: string, at: number): [string, number] {
  const next = source[at + 1] ?? "";
  const code = (digits: string, end: number): [string, number] | undefined =>
    /^[0-9a-fA-F]+$/.test(digits)
      ? [String.fromCodePoint(Math.min(parseInt(digits, 16), 0x10ffff)), end]
      : undefined;
  if (next === "u" && source[at + 2] === "{") {
    const close = source.indexOf("}", at + 3);
    const decoded =
      close === -1 ? undefined : code(source.slice(at + 3, close), close + 1);
    if (decoded) return decoded;
  } else if (next === "u") {
    const decoded = code(source.slice(at + 2, at + 6), at + 6);
    if (decoded) return decoded;
  } else if (next === "x") {
    const decoded = code(source.slice(at + 2, at + 4), at + 4);
    if (decoded) return decoded;
  }
  if (next === "\r" && source[at + 2] === "\n") return ["", at + 3];
  if (next === "\n" || next === "\r") return ["", at + 2];
  return [SIMPLE_ESCAPES[next] ?? next, at + 2];
}

const decodeEscapes = (text: string): string =>
  text.includes("\\")
    ? text.replace(
        /\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4})/g,
        (escape) => readEscape(escape, 0)[0],
      )
    : text;

/** Keywords after which `/` starts a regular expression. */
const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "yield"]);

export type Token = {
  kind: "id" | "str" | "tmpl" | "num" | "regex" | "punct";
  text: string;
};

/**
 * Splits TypeScript into tokens, dropping comments and keeping string
 * contents only as `str` tokens, so text inside strings and comments never
 * looks like code. Template substitutions are tokenized as code.
 *
 * A `/` after `)` or `}` is ambiguous without parsing (`(a) / b` divides,
 * `if (a) /re/.test(b)` starts a regular expression), and misreading it can
 * hide code inside a bogus string or regex. `slashAfterCloser` says how to
 * read it; the classifier scans both.
 */
export function tokenize(
  source: string,
  slashAfterCloser: "division" | "regex",
): Token[] {
  const tokens: Token[] = [];
  const braces: Array<"{" | "${"> = [];
  let i = 0;

  const push = (kind: Token["kind"], text: string) =>
    tokens.push({ kind, text });
  /** Reads template text from `i` up to the closing backtick or the next `${`. */
  const templateText = (open: boolean) => {
    let text = "";
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        const [decoded, end] = readEscape(source, i);
        text += decoded;
        i = end;
      } else if (char === "`") {
        i += 1;
        push(open ? "tmpl" : "str", text);
        return;
      } else if (char === "$" && source[i + 1] === "{") {
        i += 2;
        push("tmpl", text);
        push("punct", "${");
        braces.push("${");
        return;
      } else {
        text += char;
        i += 1;
      }
    }
    push("tmpl", text);
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char)) i += 1;
    else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      let text = "";
      i += 1;
      while (i < source.length && source[i] !== char && source[i] !== "\n") {
        if (source[i] === "\\") {
          const [decoded, end] = readEscape(source, i);
          text += decoded;
          i = end;
        } else {
          text += source[i];
          i += 1;
        }
      }
      i += 1;
      push("str", text);
    } else if (char === "`") {
      i += 1;
      templateText(false);
    } else if (
      IDENTIFIER_START.test(String.fromCodePoint(source.codePointAt(i)!)) ||
      (char === "\\" && next === "u")
    ) {
      IDENTIFIER.lastIndex = i;
      const match = IDENTIFIER.exec(source);
      if (match) {
        i += match[0].length;
        push("id", decodeEscapes(match[0]));
      } else {
        i += 1;
        push("punct", char);
      }
    } else if (/\d/.test(char)) {
      const start = i;
      while (i < source.length && /[\w.]/.test(source[i])) i += 1;
      push("num", source.slice(start, i));
    } else if (
      char === "/" &&
      startsRegex(tokens[tokens.length - 1], slashAfterCloser)
    ) {
      let inClass = false;
      i += 1;
      while (i < source.length && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "\n") break;
        i += 1;
      }
      i += 1;
      while (i < source.length && /\w/.test(source[i])) i += 1;
      push("regex", "");
    } else if (
      char === "?" &&
      next === "." &&
      !/\d/.test(source[i + 2] ?? "")
    ) {
      i += 2;
      push("punct", ".");
    } else if (char === "." && next === "." && source[i + 2] === ".") {
      i += 3;
      push("punct", "...");
    } else if (char === "{") {
      i += 1;
      braces.push("{");
      push("punct", "{");
    } else if (char === "}") {
      i += 1;
      push("punct", "}");
      if (braces.pop() === "${") templateText(true);
    } else {
      i += 1;
      push("punct", char);
    }
  }
  return tokens;
}

function startsRegex(
  previous: Token | undefined,
  slashAfterCloser: "division" | "regex",
): boolean {
  if (!previous) return true;
  if (previous.kind === "id") return REGEX_AFTER.has(previous.text);
  if (previous.kind !== "punct") return false;
  if (previous.text === "]") return false;
  if (previous.text === ")" || previous.text === "}")
    return slashAfterCloser === "regex";
  return true;
}

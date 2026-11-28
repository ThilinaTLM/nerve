import type { Token } from "./script-tokenizer.js";

const TARGET_KEYS = new Set(["id", "key", "space", "project"]);

/** Top-level arguments of the call whose `(` is at `open`. */
export function callArguments(tokens: Token[], open: number): Token[][] {
  const args: Token[][] = [];
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) {
        depth += 1;
        if (depth === 1) continue;
      } else if ([")", "]", "}"].includes(token.text)) {
        depth -= 1;
        if (depth === 0) return args;
      } else if (token.text === "," && depth === 1) {
        args.push([]);
        continue;
      }
    }
    if (depth >= 1) {
      if (args.length === 0) args.push([]);
      args[args.length - 1].push(token);
    }
  }
  return args;
}

const literal = (argument: Token[] | undefined): string | undefined =>
  argument?.length === 1 && argument[0].kind === "str"
    ? argument[0].text
    : undefined;

/** Literal identifiers of the call: a string first argument or `{ id: "…" }` values. */
export function callTargets(args: Token[][]): string[] {
  const first = args[0];
  if (!first) return [];
  const direct = literal(first);
  if (direct !== undefined) return [direct];
  const targets: string[] = [];
  let depth = 0;
  for (let i = 0; i < first.length; i += 1) {
    const token = first[i];
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) depth += 1;
      else if ([")", "]", "}"].includes(token.text)) depth -= 1;
    } else if (
      depth === 1 &&
      token.kind === "id" &&
      TARGET_KEYS.has(token.text) &&
      first[i + 1]?.text === ":" &&
      (first[i + 2]?.kind === "str" || first[i + 2]?.kind === "num")
    )
      targets.push(first[i + 2].text);
  }
  return targets;
}

/** Top-level properties of an object literal: key text (undefined when computed, spread or otherwise not a plain key) and the value tokens. */
export function objectProperties(
  options: Token[],
): Array<{ key?: string; value: Token[] }> | undefined {
  if (options[0]?.text !== "{" || options[options.length - 1]?.text !== "}")
    return undefined;
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of options.slice(1, -1)) {
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) depth += 1;
      else if ([")", "]", "}"].includes(token.text)) depth -= 1;
      else if (token.text === "," && depth === 0) {
        parts.push([]);
        continue;
      }
    }
    parts[parts.length - 1].push(token);
  }
  return parts
    .filter((part) => part.length > 0)
    .map((part) => {
      const [key, colon] = part;
      if ((key.kind === "id" || key.kind === "str") && colon?.text === ":")
        return { key: key.text, value: part.slice(2) };
      // Shorthand `{ name }`.
      if (key.kind === "id" && part.length === 1)
        return { key: key.text, value: part };
      return { value: part };
    });
}

export const NOT_LITERAL = Symbol("not literal");

/** The value of a literal expression (strings, numbers, booleans, null, arrays and plain objects of those), or NOT_LITERAL. */
export function literalValue(tokens: Token[]): unknown {
  let at = 0;
  const parse = (): unknown => {
    const token = tokens[at];
    if (!token) return NOT_LITERAL;
    if (token.kind === "str") {
      at += 1;
      return token.text;
    }
    if (token.kind === "num" && /^\d+(\.\d+)?$/.test(token.text)) {
      at += 1;
      return Number(token.text);
    }
    if (token.kind === "id" && ["true", "false", "null"].includes(token.text)) {
      at += 1;
      return token.text === "null" ? null : token.text === "true";
    }
    if (token.text === "[" && token.kind === "punct") {
      at += 1;
      const items: unknown[] = [];
      while (tokens[at]?.text !== "]") {
        const item = parse();
        if (item === NOT_LITERAL) return NOT_LITERAL;
        items.push(item);
        if (tokens[at]?.text === ",") at += 1;
        else if (tokens[at]?.text !== "]") return NOT_LITERAL;
      }
      at += 1;
      return items;
    }
    if (token.text === "{" && token.kind === "punct") {
      at += 1;
      const object: Record<string, unknown> = {};
      while (tokens[at]?.text !== "}") {
        const key = tokens[at];
        if (
          !key ||
          (key.kind !== "id" && key.kind !== "str") ||
          tokens[at + 1]?.text !== ":" ||
          key.text === "__proto__"
        )
          return NOT_LITERAL;
        at += 2;
        const value = parse();
        if (value === NOT_LITERAL) return NOT_LITERAL;
        object[key.text] = value;
        if (tokens[at]?.text === ",") at += 1;
        else if (tokens[at]?.text !== "}") return NOT_LITERAL;
      }
      at += 1;
      return object;
    }
    return NOT_LITERAL;
  };
  const value = parse();
  return at === tokens.length ? value : NOT_LITERAL;
}

/**
 * The argument of a method with `scanOptions`: the literal values of those options from an
 * object literal, with every other option present as `null`. NOT_LITERAL when the argument is
 * not a plain object literal (spread, computed key) or one of `keys` is not literal.
 */
export function scanOptionsValue(
  args: Token[][],
  keys: readonly string[],
): unknown {
  if (args.length !== 1) return NOT_LITERAL;
  const properties = objectProperties(args[0]);
  if (!properties || properties.some((property) => property.key === undefined))
    return NOT_LITERAL;
  const value: Record<string, unknown> = {};
  for (const property of properties) {
    if (!keys.includes(property.key!)) {
      value[property.key!] = null;
      continue;
    }
    const literal = literalValue(property.value);
    if (literal === NOT_LITERAL) return NOT_LITERAL;
    value[property.key!] = literal;
  }
  return value;
}

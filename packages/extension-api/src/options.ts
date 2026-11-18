import { ExtensionError } from "./errors.js";

/**
 * The calling convention of a namespace method taking named options: one
 * argument, an options object (or a bare string when `bare` names the option it
 * stands for). Unknown names fail with the list of valid ones, so aliases from
 * other APIs teach the right name. A bound direct tool passes its arguments
 * object as that single argument. Call it from a method's `parse`:
 * `args` is the `parse` argument, `method` the name used in error messages,
 * `spec.options` the valid option names and `spec.bare` the option a bare string
 * (or number, as its text) stands for; without `bare` a bare value is rejected.
 * `null` or `undefined` mean no options. Returns the options object; values are not validated
 * (use `nonEmptyString`). Throws `ExtensionError("BAD_REQUEST")` for more than one argument,
 * a non-object argument and unknown option names.
 */
export function parseOptions(
  method: string,
  args: readonly unknown[],
  spec: { bare?: string; options: readonly string[] },
): Record<string, unknown> {
  const bad = (message: string) => new ExtensionError("BAD_REQUEST", message);
  if (args.length > 1)
    throw bad(
      `${method} takes one argument (${spec.bare ? `a ${spec.bare} string or ` : ""}an options object), got ${args.length}.`,
    );
  const [first] = args;
  let options: Record<string, unknown>;
  if (first === undefined || first === null) options = {};
  else if (typeof first === "string" || typeof first === "number") {
    if (!spec.bare)
      throw bad(
        `${method} takes an options object: { ${spec.options.join(", ")} }.`,
      );
    options = { [spec.bare]: String(first) };
  } else if (typeof first === "object" && !Array.isArray(first))
    options = first as Record<string, unknown>;
  else throw bad(`${method} takes an options object.`);
  const unknown = Object.keys(options).filter(
    (key) => !spec.options.includes(key),
  );
  if (unknown.length > 0)
    throw bad(
      `${method} has no option '${unknown[0]}'; valid options: ${spec.options.join(", ")}.`,
    );
  return options;
}

/** A non-empty string option (numbers are accepted as their text; strings are trimmed). Throws `ExtensionError("BAD_REQUEST", "<name> must be a non-empty string.")` otherwise. */
export function nonEmptyString(value: unknown, name: string): string {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!text)
    throw new ExtensionError(
      "BAD_REQUEST",
      `${name} must be a non-empty string.`,
    );
  return text;
}

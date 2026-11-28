import {
  PRINT_CELL_CHARS,
  PRINT_EDIT_FILES,
  PRINT_ROWS,
  PRINT_STRING_CHARS,
  PRINT_VALUE_CHARS,
} from "../limits.js";
import { SANDBOX_GLOBALS } from "./sandbox-globals.js";

/**
 * Trusted sandbox code around the generated SDK: error decoding, base64 for
 * binary data on the JSON bridge, `return` printing, the bridge wrappers
 * for `files.*` and `artifacts.*`, and the `image(handle)` chain. Pieces are spliced
 * around the generated product objects (see sdk.ts) inside one function scope.
 */

export const RUNTIME_HEAD = String.raw`
  const hostCall = host.call;
  // Host failures arrive as "[CODE] message"; scripts see error.code === "CODE".
  const call = async (method, args) => {
    // Taken before the first await, so it names the script line that made the call.
    const site = /script\.ts:(\d+)/.exec(new Error().stack ?? "");
    try {
      return await hostCall(method, args);
    } catch (error) {
      const match = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(error.message);
      if (match) { error.code = match[1]; error.message = match[2]; }
      try { error.stack = "    at " + method + (site ? " (script.ts:" + site[1] + ")" : ""); } catch {}
      throw error;
    }
  };

  // A call printed or serialized without await says so instead of showing {}.
  Object.defineProperty(Promise.prototype, "toJSON", {
    value: () => "[Promise: not awaited; add await to get the value]",
  });

${SANDBOX_GLOBALS}
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const b64encode = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return out;
  };
  const B64_LOOKUP = new Uint8Array(128);
  for (let i = 0; i < 64; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;
  const b64decode = (text) => {
    const clean = text.replace(/=+$/, "");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let acc = 0, bits = 0, j = 0;
    for (let i = 0; i < clean.length; i++) {
      acc = ((acc << 6) | B64_LOOKUP[clean.charCodeAt(i)]) & 0xffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 255; }
    }
    return out;
  };

  // One formatter for console.* and the script's result, chosen for token count: text as is, flat rows as a
  // table (each key once), anything else compact JSON. Long strings, long arrays and large values are cut with a note.
  const STRING_CAP = ${PRINT_STRING_CHARS}, ROW_CAP = ${PRINT_ROWS}, VALUE_CAP = ${PRINT_VALUE_CHARS}, CELL_CAP = ${PRINT_CELL_CHARS}, FILES_CAP = ${PRINT_EDIT_FILES};
  const errorText = (error) => (typeof error.code === "string" ? error.code : error.name || "Error") + ": " + error.message;
  const dropped = (v) => v === undefined || typeof v === "function" || typeof v === "symbol";
  const prune = (value, seen) => {
    if (typeof value === "string") return value.length > STRING_CAP ? value.slice(0, STRING_CAP) + "…[+" + (value.length - STRING_CAP) + " chars]" : value;
    if (typeof value === "bigint") return value + "n";
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Error) return errorText(value);
    if (seen.has(value)) return "[circular]";
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return "[" + value.constructor.name + ", " + value.byteLength + " bytes]";
    if (typeof value.toJSON === "function") return prune(value.toJSON(), seen);
    let items = value;
    if (value instanceof Map) items = [...value.keys()].every((key) => typeof key === "string" || typeof key === "number") ? Object.fromEntries(value) : [...value];
    else if (value instanceof Set) items = [...value];
    else if (!Array.isArray(value) && value.toString !== Object.prototype.toString && typeof value.toString === "function") return String(value);
    seen.add(value);
    let out;
    if (Array.isArray(items)) {
      out = items.slice(0, ROW_CAP).map((item) => { const kept = prune(item, seen); return dropped(kept) ? null : kept; });
      if (items.length > ROW_CAP) out.push("[+" + (items.length - ROW_CAP) + " more of " + items.length + "]");
    } else {
      out = {};
      for (const key of Object.keys(items)) { const kept = prune(items[key], seen); if (!dropped(kept)) out[key] = kept; }
    }
    seen.delete(value);
    return out;
  };
  const isFlat = (row) => row !== null && typeof row === "object" && !Array.isArray(row) &&
    Object.values(row).every((v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  const cellText = (v) => {
    if (v === null || v === undefined) return "";
    const text = String(v).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
    return text.length > CELL_CAP ? text.slice(0, CELL_CAP) + "…[+" + (text.length - CELL_CAP) + " chars]" : text;
  };
  // Lines of an array's items that fit the value cap, cut between items, with what is missing and how to get it.
  const fitted = (lines, header, total, sample) => {
    let size = header.length, shown = 0;
    while (shown < lines.length && size + lines[shown].length + 1 <= VALUE_CAP) size += lines[shown++].length + 1;
    if (shown === lines.length || shown === 0) return undefined;
    const keys = sample !== null && typeof sample === "object" && !Array.isArray(sample) ? "; keys: " + Object.keys(sample).slice(0, 30).join(", ") : "";
    return { shown, note: "[" + shown + " of " + total + " items shown" + keys + ": print the fields you need, or artifacts.write the value]" };
  };
  const formatValue = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return value + "n";
    if (value === null || typeof value !== "object") return String(value);
    const pruned = prune(value, new Set());
    if (typeof pruned === "string") return pruned;
    let text;
    if (Array.isArray(pruned) && pruned.length > 0) {
      // The note for a cut array follows it on a line of its own, never as an item.
      const more = pruned.length === ROW_CAP + 1 && /^\[\+\d+ more of \d+\]$/.test(pruned[ROW_CAP]) ? pruned[ROW_CAP] : undefined;
      const rows = more ? pruned.slice(0, ROW_CAP) : pruned;
      const total = more ? Number(/of (\d+)\]$/.exec(more)[1]) : rows.length;
      const table = rows.every(isFlat);
      const columns = [];
      if (table) for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
      const header = table ? columns.join(" | ") : "";
      const lines = table ? rows.map((row) => columns.map((c) => cellText(row[c])).join(" | ")) : rows.map((row) => JSON.stringify(row) ?? "null");
      const fit = fitted(lines, header, total, rows[0]);
      const kept = fit ? lines.slice(0, fit.shown) : lines;
      const note = fit ? fit.note : more;
      text = (table ? [header, ...kept].join("\n") : "[" + kept.join(",") + "]") + (note ? "\n" + note : "");
      if (fit) return text;
    } else {
      try { text = JSON.stringify(pruned) ?? String(value); } catch { text = String(value); }
    }
    return text.length > VALUE_CAP
      ? text.slice(0, VALUE_CAP) + "\n[+" + (text.length - VALUE_CAP) + " chars cut: print the fields you need, or artifacts.write the value]"
      : text;
  };
  const print = console.log;
  const write = (...values) => print(values.map(formatValue).join(" "));
  globalThis.console = Object.freeze({ log: write, info: write, warn: write, error: write, debug: write, table: write });
  // The script's result: a top-level "return value", or the value of its last expression.
  Object.defineProperty(globalThis, "__nerveReturn", {
    value: (value) => { if (!dropped(value) && value !== "") write(value); },
  });
  // An uncaught SDK failure is reported by its code: "NOT_FOUND: message", then the call and its line.
  Object.defineProperty(globalThis, "__nerveUncaught", {
    value: (error) => {
      if (error instanceof Error && typeof error.code === "string") { try { error.name = error.code; } catch {} }
      throw error;
    },
  });
`;

/** `guarded` are the namespace globals that fail with the valid names on a misspelled method; they come from the registry. */
export const runtimeTail = (guarded: readonly string[]) => String.raw`
  // Bytes cross the JSON bridge as base64 and regexes as source + flags.
  const fromBridge = (result) => typeof result === "string" ? result : b64decode(result.data);
  const toBridge = (data, method) => {
    if (typeof data === "string") return { text: data };
    if (data instanceof ArrayBuffer) return { base64: b64encode(new Uint8Array(data)) };
    if (ArrayBuffer.isView(data)) return { base64: b64encode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) };
    throw new TypeError(method + ": data must be a string, Uint8Array or ArrayBuffer");
  };
  const withOptions = (options, map) => options !== null && typeof options === "object" && !Array.isArray(options) ? map(options) : options;
  const bridgeEdits = (edits, label) => Array.isArray(edits)
    ? edits.map((edit, index) => {
      if (edit && typeof edit.replacement === "function") {
        const error = new TypeError(label + ": edits[" + index + "].replacement must be a string. For a computed replacement use transform: (text) => text.replace(pattern, fn).");
        error.code = "BAD_REQUEST";
        throw error;
      }
      return edit && edit.pattern instanceof RegExp
        ? { ...edit, pattern: edit.pattern.source, flags: edit.flags ?? edit.pattern.flags }
        : edit;
    })
    : edits;
  // An edit result prints as its match counts and line counts per file; the diff is result.diff.
  const editSummary = (result) => {
    if (result === null || typeof result !== "object" || !Array.isArray(result.files)) return result;
    const lines = result.files.map((file) => file.path
      + (file.changed ? " +" + file.added + " -" + file.removed : " unchanged")
      + (result.counted === false ? "" : ": " + file.edits.map((edit) => "[" + edit.index + "] " + edit.matches).join(", ")));
    if (lines.length === 0) lines.push("no file changed");
    // result.files has every file; the printed form stops at a screenful.
    if (lines.length > FILES_CAP) lines.splice(FILES_CAP, lines.length, "[+" + (lines.length - FILES_CAP) + " more files: result.files]");
    delete result.counted;
    return Object.defineProperty(result, "toString", { value: () => lines.join("\n") });
  };
  for (const [namespace, label] of [[files, "files"], [artifacts, "artifacts"]]) {
    const read = namespace.read, write = namespace.write, edit = namespace.edit;
    namespace.read = async (...args) => fromBridge(await read(...args));
    namespace.write = (options, ...rest) => write(withOptions(options, (o) => ({ ...o, data: toBridge(o.data, label + ".write") })), ...rest);
    namespace.edit = async (options, ...rest) => {
      // transform runs here: the host hands over the files' text, then writes what the function returned, all or nothing.
      if (label === "files" && options !== null && typeof options === "object" && typeof options.transform === "function") {
        const { transform, dryRun, ...target } = options;
        const { staged } = await edit({ ...target, stage: true });
        const contents = [];
        for (const file of staged) {
          const text = await transform(file.text, file.path);
          if (text === undefined || text === file.text) continue;
          contents.push({ path: file.path, text, version: file.version });
        }
        return editSummary(await edit({ contents, dryRun }));
      }
      return editSummary(await edit(withOptions(options, (o) => ({ ...o, edits: bridgeEdits(o.edits, label + ".edit") })), ...rest));
    };
  }
  if (typeof launches !== "undefined") for (const method of ["start", "restart", "logs"]) {
    const original = launches[method];
    launches[method] = (options, ...rest) => original(withOptions(options, (o) => o.waitFor instanceof RegExp ? { ...o, waitFor: { source: o.waitFor.source, flags: o.waitFor.flags } } : o), ...rest);
  }

  // image(handle).resize(...).crop(...).png() | .jpeg(...) then .info() / .save(name); work happens host-side.
  const imageHost = globalThis.image;
  globalThis.image = (file) => {
    const ops = {};
    const chain = {
      resize: (options) => { ops.resize = options; return chain; },
      crop: (options) => { ops.crop = options; return chain; },
      png: () => { ops.format = "png"; delete ops.quality; return chain; },
      jpeg: (options) => { ops.format = "jpeg"; if (options && options.quality !== undefined) ops.quality = options.quality; return chain; },
      info: () => imageHost.info({ file, ops }),
      save: (name) => imageHost.save({ file, ops, name }),
    };
    return chain;
  };

  // A misspelled method fails with the valid names instead of "not a function".
  const guard = (path, target) => new Proxy(target, {
    get(object, key) {
      if (typeof key !== "string" || key in object) {
        const value = object[key];
        return value && typeof value === "object" ? guard(path + "." + key, value) : value;
      }
      if (key === "then" || key === "toJSON") return undefined;
      // web.search when the method is search.web: namespaces follow availability, so the words can come the other way round.
      const other = path.includes(".") ? undefined : globalThis[key];
      const swapped = other !== null && typeof other === "object" && path in other ? " Did you mean " + key + "." + path + "?" : "";
      const error = new TypeError(path + "." + key + " does not exist." + swapped + " Available: " + Object.keys(object).join(", ") + ".");
      error.code = "BAD_REQUEST";
      throw error;
    },
  });
  for (const name of ${JSON.stringify(guarded)}) {
    globalThis[name] = guard(name, globalThis[name]);
  }
`;

/**
 * Wraps the globals an extension's helper prelude defined (e.g. `storage`) so a
 * plain Error they throw, synchronously or as a rejection, carries
 * `code: "BAD_REQUEST"` like host failures. Errors that already have a code, and
 * the script's own errors, are untouched. Spliced around each extension prelude.
 */
export const helperErrorCoding = (prelude: string) => String.raw`{
  const before = new Set(Object.getOwnPropertyNames(globalThis));
${prelude}
  const code = (error) => {
    if (error !== null && typeof error === "object" && error.code === undefined) {
      try { error.code = "BAD_REQUEST"; } catch {}
    }
    return error;
  };
  const wrap = (value) => {
    if (typeof value === "function") {
      const wrapped = function (...args) {
        let result;
        try { result = value.apply(this, args); } catch (error) { throw code(error); }
        return result && typeof result.then === "function" ? result.then(undefined, (error) => { throw code(error); }) : result;
      };
      for (const key of Object.keys(value)) wrapped[key] = wrap(value[key]);
      return wrapped;
    }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      for (const key of Object.keys(value)) {
        try { value[key] = wrap(value[key]); } catch {}
      }
    }
    return value;
  };
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!before.has(name)) globalThis[name] = wrap(globalThis[name]);
  }
}`;

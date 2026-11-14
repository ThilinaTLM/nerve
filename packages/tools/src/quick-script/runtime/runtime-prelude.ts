/**
 * Trusted sandbox code around the generated SDK: error decoding, base64 for
 * binary data on the JSON bridge, `return` printing, and the positional
 * wrappers for `files.*` and the `image(handle)` chain. Pieces are spliced
 * around the generated product objects (see sdk.ts) inside one function scope.
 */

export const RUNTIME_HEAD = String.raw`
  const hostCall = host.call;
  // Host failures arrive as "[CODE] message"; scripts see error.code === "CODE".
  const call = async (method, args) => {
    try {
      return await hostCall(method, args);
    } catch (error) {
      const match = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(error.message);
      if (match) { error.code = match[1]; error.message = match[2]; }
      throw error;
    }
  };

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

  // A top-level "return value" prints compactly: flat objects as a table, anything else as JSON.
  const isFlat = (row) => row !== null && typeof row === "object" && !Array.isArray(row) &&
    Object.values(row).every((v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  const cellText = (v) => v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/\s*\n\s*/g, " ");
  const formatReturn = (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length > 0 && value.every(isFlat)) {
      const columns = [];
      for (const row of value) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
      return [columns.join(" | "), ...value.map((row) => columns.map((c) => cellText(row[c])).join(" | "))].join("\n");
    }
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  Object.defineProperty(globalThis, "__nerveReturn", {
    value: (value) => { const text = formatReturn(value); if (text !== undefined) console.log(text); },
  });
`;

/** `guarded` are the namespace globals that fail with the valid names on a misspelled method; they come from the registry. */
export const runtimeTail = (guarded: readonly string[]) => String.raw`
  const filesRead = files.read;
  const filesWrite = files.write;
  files.read = async (handle, options) => {
    const result = await filesRead(handle, options);
    return typeof result === "string" ? result : b64decode(result.data);
  };
  files.write = (name, data, options) => {
    let payload;
    if (typeof data === "string") payload = { text: data };
    else if (data instanceof ArrayBuffer) payload = { base64: b64encode(new Uint8Array(data)) };
    else if (ArrayBuffer.isView(data)) payload = { base64: b64encode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) };
    else throw new TypeError("files.write: data must be a string, Uint8Array or ArrayBuffer");
    return filesWrite(name, payload, options);
  };

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
      const error = new TypeError(path + "." + key + " does not exist. Available: " + Object.keys(object).join(", ") + ".");
      error.code = "BAD_REQUEST";
      throw error;
    },
  });
  for (const name of ${JSON.stringify(guarded)}) {
    globalThis[name] = guard(name, globalThis[name]);
  }
`;

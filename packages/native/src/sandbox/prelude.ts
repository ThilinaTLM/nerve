/**
 * Trusted script evaluated before every sandbox module: `console` over the
 * native `__print`, and `host.call` over `__hostCall` with JSON transport.
 */
export const BASE_PRELUDE = String.raw`
(() => {
  const print = __print;
  const hostCall = __hostCall;
  delete globalThis.__print;
  delete globalThis.__hostCall;

  const format = (value, depth = 0) => {
    if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
    if (value instanceof Error) return value.stack ? value.name + ": " + value.message + "\n" + value.stack : String(value);
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return String(value);
    if (typeof value === "bigint") return value + "n";
    try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
  };
  const write = (...values) => print(values.map((v) => format(v)).join(" "));
  globalThis.console = Object.freeze({
    log: write, info: write, warn: write, error: write, debug: write,
    table: (rows) => print(format(rows)),
  });

  globalThis.host = Object.freeze({
    async call(method, args) {
      let json;
      try {
        json = await hostCall(String(method), JSON.stringify(args ?? null));
      } catch (message) {
        const error = new Error(String(message));
        error.name = "HostError";
        throw error;
      }
      return JSON.parse(json);
    },
  });
})();
`;

/**
 * Standard globals QuickJS lacks, defined inside the sandbox: timers backed by
 * the host (`__sleep`), `sleep`, UTF-8 `TextEncoder`/`TextDecoder`, `URL` and
 * `URLSearchParams`. Spliced into the SDK prelude's function scope, where
 * `hostCall` is the raw `host.call`. Intl and crypto are not provided.
 */

/** Host-call name the runtime answers itself (see `executeQuickScript`): resolves after `ms`, rejects when the run ends. */
export const SLEEP_METHOD = "__sleep";

export const SANDBOX_GLOBALS = String.raw`
  // Timers wait on the host, so they honour the script's timeout and cancellation; clearing only stops the callback.
  const sleep = (ms) => hostCall(${JSON.stringify(SLEEP_METHOD)}, [Math.max(0, Number(ms) || 0)]).then(() => undefined);
  const timers = new Set();
  let lastTimer = 0;
  const startTimer = (callback, ms, args, repeat) => {
    if (typeof callback !== "function") throw new TypeError("timer callback must be a function");
    const id = ++lastTimer;
    const delay = repeat ? Math.max(10, Number(ms) || 0) : Number(ms) || 0;
    timers.add(id);
    const tick = () => sleep(delay).then(() => {
      if (!timers.has(id)) return;
      if (repeat) tick(); else timers.delete(id);
      callback(...args);
    }).catch((error) => {
      if (timers.delete(id) && error && error.code === undefined) console.error("Uncaught error in timer callback: " + error);
    });
    tick();
    return id;
  };
  globalThis.sleep = sleep;
  globalThis.setTimeout = (callback, ms, ...args) => startTimer(callback, ms, args, false);
  globalThis.setInterval = (callback, ms, ...args) => startTimer(callback, ms, args, true);
  globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
  // setImmediate runs after the current job queue, without a host round trip (the document libraries call it heavily).
  const immediates = new Set();
  globalThis.setImmediate = (callback, ...args) => {
    const id = ++lastTimer;
    immediates.add(id);
    Promise.resolve().then(() => { if (immediates.delete(id)) callback(...args); });
    return id;
  };
  globalThis.clearImmediate = (id) => { immediates.delete(id); };

  // The bundled PptxGenJS/JSZip replaces Promise with a polyfill that prints "Unhandled promise rejection" for a
  // rejection the script awaits one job later. A handler hook silences that report; the script's own try/catch decides.
  globalThis.onunhandledrejection = () => {};

  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return "utf-8"; }
    encode(s = "") {
      s = String(s); const out = [];
      for (let i = 0; i < s.length; i++) {
        let c = s.codePointAt(i);
        if (c > 0xffff) i++;
        if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return Uint8Array.from(out);
    }
  };
  globalThis.TextDecoder = class TextDecoder {
    constructor(label = "utf-8") { this.encoding = String(label).toLowerCase().replace("utf8", "utf-8"); }
    decode(input) {
      if (input === undefined) return "";
      const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let i = 0; if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
      const parts = []; let cur = [];
      const flush = () => { parts.push(String.fromCodePoint.apply(null, cur)); cur = []; };
      while (i < b.length) {
        const c = b[i++]; let cp;
        if (c < 0x80) cp = c;
        else if (c >= 0xc2 && c < 0xe0 && i < b.length) cp = ((c & 31) << 6) | (b[i++] & 63);
        else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else if (c >= 0xf0 && c < 0xf5 && i + 2 < b.length) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else cp = 0xfffd;
        if (cp > 0x10ffff) cp = 0xfffd;
        cur.push(cp); if (cur.length > 8192) flush();
      }
      flush(); return parts.join("");
    }
  };

  const formEncode = (s) => encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const formDecode = (s) => { s = s.replace(/\+/g, " "); try { return decodeURIComponent(s); } catch { return s; } };
  class URLSearchParams {
    #list = [];
    #onChange;
    constructor(init = "", onChange) {
      this.#onChange = onChange;
      if (init instanceof URLSearchParams) this.#list = init.#list.map((pair) => pair.slice());
      else if (typeof init === "string") this.#parse(init);
      else if (init !== null && typeof init === "object") {
        if (typeof init[Symbol.iterator] === "function") for (const pair of init) this.#list.push([String(pair[0]), String(pair[1])]);
        else for (const key of Object.keys(init)) this.#list.push([key, String(init[key])]);
      } else this.#parse(String(init));
    }
    #parse(text) {
      this.#list = [];
      for (const part of text.replace(/^\?/, "").split("&")) {
        if (!part) continue;
        const at = part.indexOf("=");
        this.#list.push(at < 0 ? [formDecode(part), ""] : [formDecode(part.slice(0, at)), formDecode(part.slice(at + 1))]);
      }
    }
    _reset(text) { this.#parse(text); }
    #changed() { if (this.#onChange) this.#onChange(this.toString()); }
    get size() { return this.#list.length; }
    append(name, value) { this.#list.push([String(name), String(value)]); this.#changed(); }
    delete(name) { name = String(name); this.#list = this.#list.filter((pair) => pair[0] !== name); this.#changed(); }
    get(name) { name = String(name); const pair = this.#list.find((p) => p[0] === name); return pair ? pair[1] : null; }
    getAll(name) { name = String(name); return this.#list.filter((p) => p[0] === name).map((p) => p[1]); }
    has(name) { name = String(name); return this.#list.some((p) => p[0] === name); }
    set(name, value) {
      name = String(name); value = String(value);
      const at = this.#list.findIndex((p) => p[0] === name);
      if (at < 0) this.#list.push([name, value]);
      else { this.#list[at][1] = value; this.#list = this.#list.filter((p, i) => i <= at || p[0] !== name); }
      this.#changed();
    }
    sort() { this.#list = this.#list.map((p, i) => [p, i]).sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1])).map((x) => x[0]); this.#changed(); }
    forEach(callback, thisArg) { for (const [name, value] of this.#list.map((p) => p.slice())) callback.call(thisArg, value, name, this); }
    *entries() { for (const pair of this.#list.map((p) => p.slice())) yield pair; }
    *keys() { for (const pair of this.entries()) yield pair[0]; }
    *values() { for (const pair of this.entries()) yield pair[1]; }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this.#list.map((p) => formEncode(p[0]) + "=" + formEncode(p[1])).join("&"); }
  }
  const DEFAULT_PORTS = { "http:": "80", "https:": "443", "ftp:": "21", "ws:": "80", "wss:": "443" };
  const SPECIAL = ["http:", "https:", "ftp:", "ws:", "wss:", "file:"];
  const encodePart = (s) => s.replace(/[\u0000-\u0020"<>\x60{}\u007f-\uffff]/g, (c) => encodeURIComponent(c));
  const dropDots = (path) => {
    const out = [];
    const segments = path.split("/");
    segments.forEach((segment, i) => {
      if (segment === "..") { if (out.length > 1) out.pop(); if (i === segments.length - 1) out.push(""); }
      else if (segment === ".") { if (i === segments.length - 1) out.push(""); }
      else out.push(segment);
    });
    return out.join("/");
  };
  class URL {
    #p;
    constructor(input, base) {
      input = String(input).trim();
      let match = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(.*)$/.exec(input);
      let p;
      if (match) {
        p = URL.#absolute(match[1].toLowerCase(), match[2], input);
      } else {
        if (base === undefined) throw new TypeError("Invalid URL: " + input);
        const b = (base instanceof URL ? base : new URL(base)).#p;
        const [, rest, hash = ""] = /^([^#]*)(#.*)?$/.exec(input);
        const [path, query] = (() => { const q = rest.indexOf("?"); return q < 0 ? [rest, undefined] : [rest.slice(0, q), rest.slice(q)]; })();
        p = { ...b, hash: hash === "#" ? "" : encodePart(hash) };
        if (rest.startsWith("//")) p = URL.#absolute(b.protocol, rest, input, hash);
        else if (path !== "") {
          const dir = b.pathname.slice(0, b.pathname.lastIndexOf("/") + 1);
          p.pathname = dropDots(encodePart(path.startsWith("/") ? path : dir + path));
          p.search = query === undefined || query === "?" ? "" : encodePart(query);
        } else if (query !== undefined) p.search = query === "?" ? "" : encodePart(query);
      }
      this.#p = p;
      this.searchParams = new URLSearchParams(p.search, (text) => { this.#p.search = text ? "?" + text : ""; });
    }
    static #absolute(protocol, rest, input, forcedHash) {
      const special = SPECIAL.includes(protocol);
      let hash = forcedHash ?? "", search = "", authority = "", pathname;
      const hashAt = rest.indexOf("#");
      if (hashAt >= 0 && forcedHash === undefined) { hash = rest.slice(hashAt); rest = rest.slice(0, hashAt); }
      else if (hashAt >= 0) rest = rest.slice(0, hashAt);
      const queryAt = rest.indexOf("?");
      if (queryAt >= 0) { search = rest.slice(queryAt); rest = rest.slice(0, queryAt); }
      if (rest.startsWith("//") || (special && protocol !== "file:")) {
        rest = rest.replace(/^[\/\\]*/, "");
        const slash = rest.search(/[\/\\]/);
        authority = slash < 0 ? rest : rest.slice(0, slash);
        pathname = slash < 0 ? "" : rest.slice(slash).replace(/\\/g, "/");
      } else pathname = rest;
      const at = authority.lastIndexOf("@");
      const userinfo = at < 0 ? "" : authority.slice(0, at);
      const hostport = at < 0 ? authority : authority.slice(at + 1);
      const portMatch = /^(.*?)(?::(\d*))?$/.exec(hostport);
      let hostname = portMatch[1].toLowerCase(), port = portMatch[2] || "";
      if (hostport.startsWith("[")) { const m = /^(\[[^\]]*\])(?::(\d*))?$/.exec(hostport); if (!m) throw new TypeError("Invalid URL: " + input); hostname = m[1].toLowerCase(); port = m[2] || ""; }
      if (special && protocol !== "file:" && !hostname) throw new TypeError("Invalid URL: " + input);
      if (/[\s<>^|%]/.test(hostname)) throw new TypeError("Invalid URL: " + input);
      if (port === DEFAULT_PORTS[protocol]) port = "";
      if (special && !pathname.startsWith("/")) pathname = "/" + pathname;
      if (special) pathname = dropDots(pathname);
      const colon = userinfo.indexOf(":");
      return {
        protocol, hostname, port, hasAuthority: authority !== "" || special,
        username: colon < 0 ? userinfo : userinfo.slice(0, colon), password: colon < 0 ? "" : userinfo.slice(colon + 1),
        pathname: encodePart(pathname), search: search === "?" ? "" : encodePart(search), hash: hash === "#" ? "" : encodePart(hash),
      };
    }
    get protocol() { return this.#p.protocol; }
    get username() { return this.#p.username; }
    get password() { return this.#p.password; }
    get hostname() { return this.#p.hostname; }
    get port() { return this.#p.port; }
    get host() { return this.#p.hostname + (this.#p.port ? ":" + this.#p.port : ""); }
    get origin() { return SPECIAL.includes(this.#p.protocol) && this.#p.protocol !== "file:" ? this.#p.protocol + "//" + this.host : "null"; }
    get pathname() { return this.#p.pathname; }
    set pathname(value) { this.#p.pathname = encodePart(String(value).startsWith("/") ? String(value) : "/" + value); }
    get search() { return this.#p.search; }
    set search(value) { value = String(value); this.#p.search = value === "" || value === "?" ? "" : encodePart(value.startsWith("?") ? value : "?" + value); this.searchParams._reset(this.#p.search); }
    get hash() { return this.#p.hash; }
    set hash(value) { value = String(value); this.#p.hash = value === "" || value === "#" ? "" : encodePart(value.startsWith("#") ? value : "#" + value); }
    get href() {
      const p = this.#p;
      const credentials = p.username ? p.username + (p.password ? ":" + p.password : "") + "@" : "";
      return p.protocol + (p.hasAuthority ? "//" + credentials + this.host : "") + p.pathname + p.search + p.hash;
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static canParse(input, base) { try { new URL(input, base); return true; } catch { return false; } }
  }
  globalThis.URL = URL;
  globalThis.URLSearchParams = URLSearchParams;
`;

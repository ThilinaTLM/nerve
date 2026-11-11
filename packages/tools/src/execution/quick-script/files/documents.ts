/**
 * Sandbox-side additions for the document libraries (docx, mammoth, PptxGenJS,
 * JSZip). Plain classic-script source, evaluated inside the sandbox by
 * libraries.ts — never in the host.
 */

/** Minimal runtime pieces the vendored libraries assume exist (UTF-8 codecs, timers). */
export const DOCUMENT_SHIMS = String.raw`(() => {
  const g = globalThis;
  if (typeof g.TextEncoder === "undefined") {
    g.TextEncoder = class TextEncoder {
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
  }
  if (typeof g.TextDecoder === "undefined") {
    g.TextDecoder = class TextDecoder {
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
  }
  if (typeof g.setTimeout === "undefined") {
    let id = 0; const live = new Set();
    g.setTimeout = (fn, _ms, ...args) => { const t = ++id; live.add(t); Promise.resolve().then(() => { if (live.delete(t)) fn(...args); }); return t; };
    g.clearTimeout = (t) => { live.delete(t); };
    g.setImmediate = (fn, ...args) => g.setTimeout(fn, 0, ...args);
    g.clearImmediate = g.clearTimeout;
  }
})();`;

/**
 * Runs right after mammoth loads. Accepts a Uint8Array/ArrayBuffer directly
 * (what files.read returns) and, unless the caller passes `convertImage`,
 * replaces inlined data-URI images with a short `[image: type]` placeholder.
 */
export const MAMMOTH_WRAPPER = String.raw`(() => {
  const mammoth = globalThis.mammoth;
  const input = (value) => {
    if (value instanceof ArrayBuffer) return { arrayBuffer: value };
    if (ArrayBuffer.isView(value)) {
      const { buffer, byteOffset, byteLength } = value;
      return { arrayBuffer: buffer.slice(byteOffset, byteOffset + byteLength) };
    }
    return value;
  };
  const placeholder = (text) => text
    .replace(/<img[^>]*src="qsimg:([^"]*)"[^>]*>/g, "[image: $1]")
    .replace(/!\[[^\]]*\]\(qsimg:([^)]*)\)/g, "[image: $1]");
  for (const name of ["convertToHtml", "convertToMarkdown"]) {
    const original = mammoth[name];
    mammoth[name] = async (source, options) => {
      const own = options && options.convertImage;
      const result = await original.call(mammoth, input(source), own ? options : {
        ...options,
        convertImage: mammoth.images.imgElement(async (image) => ({ src: "qsimg:" + image.contentType })),
      });
      if (!own) result.value = placeholder(result.value);
      return result;
    };
  }
  const extract = mammoth.extractRawText;
  mammoth.extractRawText = (source, options) => extract.call(mammoth, input(source), options);
})();`;

/** `pptxText(bytes)` → { slides: [{ index, text, notes }] }; needs JSZip. */
export const PPTX_TEXT = String.raw`globalThis.pptxText = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
  const paragraphs = (xml) => [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)].map((m) => m[1] === undefined ? "\n" : decode(m[1])).join(""))
    .filter(Boolean);
  const number = (name) => +name.match(/(\d+)\.xml$/)[1];
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => number(a) - number(b));
  const slides = [];
  for (const name of names) {
    const text = paragraphs(await zip.file(name).async("string")).join("\n");
    const notesFile = zip.file(name.replace("slides/slide", "notesSlides/notesSlide"));
    const notes = notesFile ? paragraphs(await notesFile.async("string")).filter((line) => !/^\d+$/.test(line)).join("\n") : "";
    slides.push({ index: slides.length + 1, text, notes });
  }
  return { slides };
};`;

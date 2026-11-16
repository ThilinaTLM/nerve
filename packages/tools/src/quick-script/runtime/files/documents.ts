/**
 * Sandbox-side additions for the document libraries (docx, mammoth, PptxGenJS,
 * JSZip). Plain classic-script source, evaluated inside the sandbox by
 * libraries.ts — never in the host.
 */

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

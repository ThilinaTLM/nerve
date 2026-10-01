/**
 * Whether `header` starts an SVG document: an optional XML declaration, then
 * any comments or `<!DOCTYPE svg …>` declarations, then an `<svg` root tag.
 *
 * A single forward scan keeps this linear in the header length, unlike an
 * equivalent repeated-alternation regex.
 */
export function startsWithSvgRoot(header: string): boolean {
  const text = header.toLowerCase();
  let at = skipWhitespace(text, text.startsWith("\uFEFF") ? 1 : 0);
  if (text.startsWith("<?xml", at)) {
    at = after(text, "?>", at + 5);
    if (at < 0) return false;
  }
  while (true) {
    at = skipWhitespace(text, at);
    if (text.startsWith("<!--", at)) {
      at = after(text, "-->", at + 4);
    } else if (text.startsWith("<!doctype svg", at)) {
      at = after(text, ">", at + 13);
    } else {
      return text.startsWith("<svg", at) && /[\s>]/.test(text.charAt(at + 4));
    }
    if (at < 0) return false;
  }
}

function skipWhitespace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
  return at;
}

function after(text: string, marker: string, from: number): number {
  const index = text.indexOf(marker, from);
  return index < 0 ? -1 : index + marker.length;
}

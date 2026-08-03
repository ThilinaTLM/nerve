type AnsiStyleState = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  hidden: boolean;
  strike: boolean;
  fgClass?: string;
  bgClass?: string;
  fgColor?: string;
  bgColor?: string;
};

const ANSI_COLOR_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

const CSI_FINAL_BYTE = /[\x40-\x7e]/;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_URL_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);
const URL_CLOSING_PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

export type AnsiToHtmlOptions = {
  linkifyUrls?: boolean;
};

function initialState(): AnsiStyleState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    hidden: false,
    strike: false,
    fgClass: undefined,
    bgClass: undefined,
    fgColor: undefined,
    bgColor: undefined,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function colorClass(prefix: "fg" | "bg", code: number): string | undefined {
  if (code >= 30 && code <= 37) {
    return `ansi-${prefix}-${ANSI_COLOR_NAMES[code - 30]}`;
  }
  if (code >= 90 && code <= 97) {
    return `ansi-${prefix}-bright-${ANSI_COLOR_NAMES[code - 90]}`;
  }
  if (code >= 40 && code <= 47) {
    return `ansi-${prefix}-${ANSI_COLOR_NAMES[code - 40]}`;
  }
  if (code >= 100 && code <= 107) {
    return `ansi-${prefix}-bright-${ANSI_COLOR_NAMES[code - 100]}`;
  }
  return undefined;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbCss(red: number, green: number, blue: number): string {
  return `rgb(${clampByte(red)} ${clampByte(green)} ${clampByte(blue)})`;
}

function xterm256ToRgb(value: number): string {
  const color = clampByte(value);
  if (color < 16) {
    const base = [
      [0, 0, 0],
      [128, 0, 0],
      [0, 128, 0],
      [128, 128, 0],
      [0, 0, 128],
      [128, 0, 128],
      [0, 128, 128],
      [192, 192, 192],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [255, 255, 0],
      [0, 0, 255],
      [255, 0, 255],
      [0, 255, 255],
      [255, 255, 255],
    ][color];
    return rgbCss(base[0], base[1], base[2]);
  }
  if (color >= 232) {
    const gray = 8 + (color - 232) * 10;
    return rgbCss(gray, gray, gray);
  }
  const offset = color - 16;
  const red = Math.floor(offset / 36);
  const green = Math.floor((offset % 36) / 6);
  const blue = offset % 6;
  const component = (index: number) => (index === 0 ? 0 : 55 + index * 40);
  return rgbCss(component(red), component(green), component(blue));
}

function parseSgrParameters(sequence: string): number[] {
  const body = sequence.slice(0, -1).replaceAll(":", ";");
  if (body.trim() === "") return [0];
  return body.split(";").map((part) => {
    if (part === "") return 0;
    const value = Number(part);
    return Number.isFinite(value) ? value : Number.NaN;
  });
}

function applyColor(
  state: AnsiStyleState,
  target: "fg" | "bg",
  code: number,
  params: number[],
  index: number,
): number {
  const classKey = target === "fg" ? "fgClass" : "bgClass";
  const colorKey = target === "fg" ? "fgColor" : "bgColor";

  if (code === 5) {
    const color = params[index + 1];
    if (Number.isFinite(color)) {
      state[classKey] = undefined;
      state[colorKey] = xterm256ToRgb(color);
      return index + 1;
    }
    return index;
  }

  if (code === 2) {
    const red = params[index + 1];
    const green = params[index + 2];
    const blue = params[index + 3];
    if (
      Number.isFinite(red) &&
      Number.isFinite(green) &&
      Number.isFinite(blue)
    ) {
      state[classKey] = undefined;
      state[colorKey] = rgbCss(red, green, blue);
      return index + 3;
    }
  }

  return index;
}

function applySgr(state: AnsiStyleState, sequence: string): AnsiStyleState {
  const next = { ...state };
  const params = parseSgrParameters(sequence);

  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (!Number.isFinite(code)) continue;

    if (code === 0) {
      Object.assign(next, initialState());
    } else if (code === 1) {
      next.bold = true;
      next.dim = false;
    } else if (code === 2) {
      next.dim = true;
      next.bold = false;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 7) {
      next.inverse = true;
    } else if (code === 8) {
      next.hidden = true;
    } else if (code === 9) {
      next.strike = true;
    } else if (code === 21 || code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) {
      next.italic = false;
    } else if (code === 24) {
      next.underline = false;
    } else if (code === 27) {
      next.inverse = false;
    } else if (code === 28) {
      next.hidden = false;
    } else if (code === 29) {
      next.strike = false;
    } else if (code === 39) {
      next.fgClass = undefined;
      next.fgColor = undefined;
    } else if (code === 49) {
      next.bgClass = undefined;
      next.bgColor = undefined;
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      next.fgClass = colorClass("fg", code);
      next.fgColor = undefined;
    } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      next.bgClass = colorClass("bg", code);
      next.bgColor = undefined;
    } else if (code === 38) {
      index = applyColor(next, "fg", params[index + 1], params, index + 1);
    } else if (code === 48) {
      index = applyColor(next, "bg", params[index + 1], params, index + 1);
    }
  }

  return next;
}

function stateClasses(state: AnsiStyleState): string[] {
  return [
    state.bold ? "ansi-bold" : undefined,
    state.dim ? "ansi-dim" : undefined,
    state.italic ? "ansi-italic" : undefined,
    state.underline ? "ansi-underline" : undefined,
    state.inverse ? "ansi-inverse" : undefined,
    state.hidden ? "ansi-hidden" : undefined,
    state.strike ? "ansi-strike" : undefined,
    state.fgClass,
    state.bgClass,
  ].filter((value): value is string => Boolean(value));
}

function stateStyle(state: AnsiStyleState): string | undefined {
  const declarations = [
    state.fgColor ? `color: ${state.fgColor}` : undefined,
    state.bgColor ? `background-color: ${state.bgColor}` : undefined,
  ].filter(Boolean);
  return declarations.length > 0 ? declarations.join("; ") : undefined;
}

function countCharacter(text: string, character: string): number {
  let count = 0;
  for (const value of text) {
    if (value === character) count += 1;
  }
  return count;
}

function trimUrlPunctuation(value: string): { url: string; trailing: string } {
  let end = value.length;
  while (end > 0) {
    const last = value[end - 1];
    if (TRAILING_URL_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    const opening = URL_CLOSING_PAIRS[last];
    const candidate = value.slice(0, end);
    if (
      opening &&
      countCharacter(candidate, last) > countCharacter(candidate, opening)
    ) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: value.slice(0, end), trailing: value.slice(end) };
}

function isSafeWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

type UrlRange = {
  start: number;
  end: number;
  url: string;
};

type AnsiTextRun = {
  text: string;
  state: AnsiStyleState;
};

function findUrlRanges(text: string): UrlRange[] {
  const ranges: UrlRange[] = [];
  URL_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const { url } = trimUrlPunctuation(raw);
    if (url && isSafeWebUrl(url)) {
      ranges.push({ start: match.index, end: match.index + url.length, url });
    }
  }
  return ranges;
}

type AnsiTextFragment = AnsiTextRun & {
  url?: string;
};

function splitRunAtUrls(
  run: AnsiTextRun,
  start: number,
  ranges: readonly UrlRange[],
): AnsiTextFragment[] {
  const end = start + run.text.length;
  const fragments: AnsiTextFragment[] = [];
  let offset = 0;

  for (const range of ranges) {
    if (range.end <= start) continue;
    if (range.start >= end) break;
    const linkStart = Math.max(range.start, start) - start;
    const linkEnd = Math.min(range.end, end) - start;
    if (linkStart > offset) {
      fragments.push({
        text: run.text.slice(offset, linkStart),
        state: run.state,
      });
    }
    fragments.push({
      text: run.text.slice(linkStart, linkEnd),
      state: run.state,
      url: range.url,
    });
    offset = linkEnd;
  }

  if (offset < run.text.length) {
    fragments.push({ text: run.text.slice(offset), state: run.state });
  }
  return fragments;
}

function renderStyledText(fragment: AnsiTextFragment): string {
  const rendered = escapeHtml(fragment.text);
  const classes = stateClasses(fragment.state);
  const style = stateStyle(fragment.state);
  if (classes.length === 0 && style === undefined) return rendered;
  const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  const styleAttr = style ? ` style="${style}"` : "";
  return `<span${classAttr}${styleAttr}>${rendered}</span>`;
}

function renderFragments(fragments: readonly AnsiTextFragment[]): string {
  let output = "";
  let activeUrl: string | undefined;

  for (const fragment of fragments) {
    if (fragment.url !== activeUrl) {
      if (activeUrl) output += "</a>";
      if (fragment.url) {
        const escapedUrl = escapeHtml(fragment.url);
        output += `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">`;
      }
      activeUrl = fragment.url;
    }
    output += renderStyledText(fragment);
  }

  if (activeUrl) output += "</a>";
  return output;
}

function csiEndIndex(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (CSI_FINAL_BYTE.test(text[index])) return index;
  }
  return -1;
}

function oscEndIndex(text: string, start: number): number {
  const bel = text.indexOf("\u0007", start);
  const st = text.indexOf("\u001b\\", start);
  if (bel === -1) return st === -1 ? -1 : st + 1;
  if (st === -1) return bel;
  return Math.min(bel, st + 1);
}

function parseAnsiTextRuns(text: string): AnsiTextRun[] {
  const runs: AnsiTextRun[] = [];
  let state = initialState();
  let plainStart = 0;
  let index = 0;

  const appendRun = (end: number) => {
    const value = text.slice(plainStart, end);
    if (value) runs.push({ text: value, state });
  };

  while (index < text.length) {
    if (text.charCodeAt(index) !== 0x1b) {
      index += 1;
      continue;
    }

    appendRun(index);
    const next = text[index + 1];

    if (next === "[") {
      const end = csiEndIndex(text, index + 2);
      if (end === -1) {
        plainStart = text.length;
        break;
      }
      const sequence = text.slice(index + 2, end + 1);
      if (sequence.endsWith("m")) state = applySgr(state, sequence);
      index = end + 1;
      plainStart = index;
      continue;
    }

    if (next === "]") {
      const end = oscEndIndex(text, index + 2);
      if (end === -1) {
        plainStart = text.length;
        break;
      }
      index = end + 1;
      plainStart = index;
      continue;
    }

    index = Math.min(index + 2, text.length);
    plainStart = index;
  }

  appendRun(text.length);
  return runs;
}

export function ansiToHtml(
  text: string,
  options: AnsiToHtmlOptions = {},
): string {
  const runs = parseAnsiTextRuns(text);
  const visibleText = runs.map((run) => run.text).join("");
  const ranges = options.linkifyUrls ? findUrlRanges(visibleText) : [];
  let offset = 0;
  const fragments: AnsiTextFragment[] = [];
  for (const run of runs) {
    fragments.push(...splitRunAtUrls(run, offset, ranges));
    offset += run.text.length;
  }
  return renderFragments(fragments);
}

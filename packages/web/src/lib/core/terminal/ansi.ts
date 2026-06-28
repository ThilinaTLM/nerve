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

function renderText(text: string, state: AnsiStyleState): string {
  if (text.length === 0) return "";
  const escaped = escapeHtml(text);
  const classes = stateClasses(state);
  const style = stateStyle(state);
  if (classes.length === 0 && style === undefined) return escaped;
  const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  const styleAttr = style ? ` style="${style}"` : "";
  return `<span${classAttr}${styleAttr}>${escaped}</span>`;
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

export function ansiToHtml(text: string): string {
  let output = "";
  let state = initialState();
  let plainStart = 0;
  let index = 0;

  while (index < text.length) {
    if (text.charCodeAt(index) !== 0x1b) {
      index += 1;
      continue;
    }

    output += renderText(text.slice(plainStart, index), state);
    const next = text[index + 1];

    if (next === "[") {
      const end = csiEndIndex(text, index + 2);
      if (end === -1) break;
      const sequence = text.slice(index + 2, end + 1);
      if (sequence.endsWith("m")) state = applySgr(state, sequence);
      index = end + 1;
      plainStart = index;
      continue;
    }

    if (next === "]") {
      const end = oscEndIndex(text, index + 2);
      if (end === -1) break;
      index = end + 1;
      plainStart = index;
      continue;
    }

    index = Math.min(index + 2, text.length);
    plainStart = index;
  }

  output += renderText(text.slice(plainStart), state);
  return output;
}

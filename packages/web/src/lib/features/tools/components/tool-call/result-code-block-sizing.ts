export type BoxChromeMetrics = {
  borderBoxWidth: number;
  paddingLeft: number;
  paddingRight: number;
  borderLeftWidth: number;
  borderRightWidth: number;
};

export function parseCssPixels(
  value: string | undefined,
  fallback = 0,
): number {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return fallback;
  const parsed = Number.parseFloat(trimmed.slice(0, -2));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function computedLineHeightPixels(
  lineHeight: string | undefined,
  fontSize: string | undefined,
  fallback = 16,
): number {
  const parsedLineHeight = parseCssPixels(lineHeight);
  if (parsedLineHeight > 0) return parsedLineHeight;

  const parsedFontSize = parseCssPixels(fontSize, fallback);
  return parsedFontSize > 0 ? parsedFontSize * 1.4 : fallback * 1.4;
}

export function contentWidthFromBorderBox(metrics: BoxChromeMetrics): number {
  const width =
    metrics.borderBoxWidth -
    metrics.paddingLeft -
    metrics.paddingRight -
    metrics.borderLeftWidth -
    metrics.borderRightWidth;
  return Math.max(0, width);
}

export function visualRowsFromScrollHeight(
  scrollHeight: number,
  lineHeightPixels: number,
): number {
  if (scrollHeight <= 0 || lineHeightPixels <= 0) return 0;
  return Math.max(1, Math.ceil(scrollHeight / lineHeightPixels));
}

export function nextFixedVisibleRows(options: {
  previousRows: number;
  measuredRows?: number;
  fallbackRows: number;
  fixedRows: number;
}): number {
  const fixedRows = Math.max(1, Math.floor(options.fixedRows));
  const fallbackRows = Math.max(1, Math.ceil(options.fallbackRows));
  const measuredRows =
    options.measuredRows !== undefined && options.measuredRows > 0
      ? Math.ceil(options.measuredRows)
      : fallbackRows;
  const nextRows = Math.min(Math.max(1, measuredRows), fixedRows);
  return Math.max(options.previousRows, nextRows);
}

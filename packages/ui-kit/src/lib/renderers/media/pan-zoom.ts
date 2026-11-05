export type PanZoomTransform = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** Centers `content` in `viewport` at the largest scale that fits inside the
 * padding, never above `maxScale` (images don't upscale past 100%). */
export function fitTransform(
  viewport: Size,
  content: Size,
  padding: number,
  maxScale = MAX_SCALE,
): PanZoomTransform {
  const width = Math.max(1, viewport.width - padding * 2);
  const height = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(
    Math.min(width / content.width, height / content.height, maxScale),
  );
  return centeredTransform(viewport, content, scale);
}

export function centeredTransform(
  viewport: Size,
  content: Size,
  scale: number,
): PanZoomTransform {
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

/** Zooms to `nextScale` keeping the content point under `point` fixed. */
export function zoomTransform(
  current: PanZoomTransform,
  nextScale: number,
  point: { x: number; y: number },
): PanZoomTransform {
  const scale = clampScale(nextScale);
  const contentX = (point.x - current.x) / current.scale;
  const contentY = (point.y - current.y) / current.scale;
  return {
    scale,
    x: point.x - contentX * scale,
    y: point.y - contentY * scale,
  };
}

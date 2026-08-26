export type ItemRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RelativeItemRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Returns target geometry in the collection's local coordinate space, snapped to
 * whole `scale` (device-pixel) steps so the 1px outline never straddles a pixel
 * boundary and fades out at fractional zoom levels or panel sizes.
 */
export function relativeItemRectangle(
  collection: ItemRectangle,
  target: ItemRectangle,
  scale = 1,
): RelativeItemRectangle {
  const snap = (value: number): number => Math.round(value * scale) / scale;
  const x = snap(target.left - collection.left);
  const y = snap(target.top - collection.top);
  // Pixel snapping can round an edge-aligned target beyond a fractional
  // collection edge, where the containing viewport would clip the outline.
  const right = Math.min(
    snap(target.left + target.width - collection.left),
    collection.width,
  );
  const bottom = Math.min(
    snap(target.top + target.height - collection.top),
    collection.height,
  );
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

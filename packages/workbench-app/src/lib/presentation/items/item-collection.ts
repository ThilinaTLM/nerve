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
  return {
    x,
    y,
    width: snap(target.left + target.width - collection.left) - x,
    height: snap(target.top + target.height - collection.top) - y,
  };
}

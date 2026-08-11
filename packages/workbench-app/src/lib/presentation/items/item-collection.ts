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

/** Returns target geometry in the collection's local coordinate space. */
export function relativeItemRectangle(
  collection: ItemRectangle,
  target: ItemRectangle,
): RelativeItemRectangle {
  return {
    x: target.left - collection.left,
    y: target.top - collection.top,
    width: target.width,
    height: target.height,
  };
}

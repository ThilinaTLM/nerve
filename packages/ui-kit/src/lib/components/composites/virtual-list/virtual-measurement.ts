export const VIRTUAL_MEASUREMENT_EPSILON_PX = 0.5;

/** Avoid redundant virtualizer writes for unchanged/sub-pixel-equivalent rows. */
export function shouldCommitVirtualMeasurement(
  previousHeight: number | undefined,
  nextHeight: number,
  epsilon = VIRTUAL_MEASUREMENT_EPSILON_PX,
): boolean {
  return (
    previousHeight === undefined ||
    !Number.isFinite(previousHeight) ||
    Math.abs(previousHeight - nextHeight) > epsilon
  );
}

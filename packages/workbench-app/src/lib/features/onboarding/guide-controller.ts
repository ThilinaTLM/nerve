import type { VersionedGuideItem } from "./guide-content.js";

export function shouldAutoOpenGuide(input: {
  progressiveActive: boolean;
  settingsLoaded: boolean;
  completedVersion: number;
  currentVersion: number;
  generation: number;
  consideredGeneration?: number;
}): boolean {
  return (
    input.progressiveActive &&
    input.settingsLoaded &&
    input.completedVersion < input.currentVersion &&
    input.consideredGeneration !== input.generation
  );
}

export function filterGuideItems<T extends VersionedGuideItem>(
  items: readonly T[],
  completedVersion: number,
  manual: boolean,
): T[] {
  return items.filter((item) => manual || item.introducedIn > completedVersion);
}

export function adjacentStep(
  index: number,
  length: number,
  direction: -1 | 1,
): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + direction));
}

export type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type CalloutPlacement = {
  top: number;
  left: number;
  side: "top" | "bottom" | "center";
};

export function calloutPlacement(input: {
  target?: Rect;
  viewportWidth: number;
  viewportHeight: number;
  calloutWidth: number;
  calloutHeight: number;
  compact: boolean;
  gap?: number;
  margin?: number;
}): CalloutPlacement {
  const gap = input.gap ?? 12;
  const margin = input.margin ?? 12;
  const maxLeft = Math.max(
    margin,
    input.viewportWidth - input.calloutWidth - margin,
  );
  const centeredLeft = Math.min(
    maxLeft,
    Math.max(margin, (input.viewportWidth - input.calloutWidth) / 2),
  );

  if (input.compact || !input.target) {
    return {
      top: Math.max(
        margin,
        input.viewportHeight - input.calloutHeight - margin,
      ),
      left: centeredLeft,
      side: "center",
    };
  }

  const targetCenter = input.target.left + input.target.width / 2;
  const left = Math.min(
    maxLeft,
    Math.max(margin, targetCenter - input.calloutWidth / 2),
  );
  const fitsBelow =
    input.target.bottom + gap + input.calloutHeight <=
    input.viewportHeight - margin;
  if (fitsBelow) {
    return { top: input.target.bottom + gap, left, side: "bottom" };
  }
  const fitsAbove = input.target.top - gap - input.calloutHeight >= margin;
  if (fitsAbove) {
    return {
      top: input.target.top - gap - input.calloutHeight,
      left,
      side: "top",
    };
  }
  return {
    top: Math.max(margin, (input.viewportHeight - input.calloutHeight) / 2),
    left: centeredLeft,
    side: "center",
  };
}

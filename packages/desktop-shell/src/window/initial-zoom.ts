export const INITIAL_ZOOM_LEVEL_PARAM = "nerveInitialZoomLevel";

export function withInitialZoomLevel(
  daemonUrl: string,
  zoomLevel: number | undefined,
): string {
  if (zoomLevel === undefined || !Number.isInteger(zoomLevel)) return daemonUrl;
  const url = new URL(daemonUrl);
  url.searchParams.set(INITIAL_ZOOM_LEVEL_PARAM, String(zoomLevel));
  return url.toString();
}

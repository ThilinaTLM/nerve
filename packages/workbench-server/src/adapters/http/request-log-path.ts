/** Preview capability IDs are credentials, including in revocation and failed-auth URLs. */
export function requestLogPath(url: string): string {
  return new URL(url).pathname.replace(
    /^(\/api\/filesystem\/html-preview|\/html-preview)\/[^/]+/,
    "$1/:id",
  );
}

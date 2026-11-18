/** Preview capability IDs are credentials, including in revocation and failed-auth URLs. */
export function requestLogPath(url: string): string {
  return new URL(url).pathname
    .replace(/^\/ext-frame\/[a-f0-9]{64}\//, "/ext-frame/:token/")
    .replace(
      /^(\/api\/filesystem\/html-preview|\/html-preview)\/[^/]+/,
      "$1/:id",
    );
}

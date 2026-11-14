/**
 * Remove trailing slashes in linear time. A `/\/+$/` regex backtracks
 * quadratically on long slash runs in untrusted site URLs.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

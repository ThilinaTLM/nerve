/**
 * Readability evidence that the current reader accepts without a new sweep:
 * released build IDs (`<version>:<source>`) by version, and exact prior reader
 * IDs whose persisted read schemas are semantically equivalent.
 */
const RELEASES_BY_READER: Readonly<Record<string, readonly string[]>> = {
  // The layered-capabilities reader differs from the post-Kroki reader only
  // in the capability override schema used by conversation creation requests,
  // which no persisted payload reads. Pre-Kroki evidence still needs a sweep.
  "reader:d6d9ca12247c34c4009249690a60fff6f22948c6f21bbe5b9503732bd8cc0fea": [
    "reader:e757c9731dce7f48cde69d3cd4ff53ec73ca04d2d58fd70e31261415a29a366c",
  ],
};

export function legacyReadCompatibilityReleases(
  readCompatibilityId: string,
): readonly string[] {
  return RELEASES_BY_READER[readCompatibilityId] ?? [];
}

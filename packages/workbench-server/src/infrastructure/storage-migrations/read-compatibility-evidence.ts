const RELEASES_BY_READER: Readonly<Record<string, readonly string[]>> = {
  // The 0.32.0–0.32.2 persisted reader is semantically equivalent to the
  // validation-only reader introduced for 0.32.3. Packaged startup used the
  // stale 0.31.1 fallback when npm_package_version was absent, so that value is
  // accepted only after the complete framework ledger has already matched.
  "reader:dc386ff3135953598cb8a2dc9f8bdc8c28a52f345edfbba40c716049651d0769": [
    "0.31.1",
    "0.32.0",
    "0.32.1",
    "0.32.2",
  ],
};

export function legacyReadCompatibilityReleases(
  readCompatibilityId: string,
): readonly string[] {
  return RELEASES_BY_READER[readCompatibilityId] ?? [];
}

import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { assertReleaseVersion } from "./release-version.mjs";

const PENDING_RELEASE = 'releasedIn: "next"';
const NEWS_CATALOG_PATH = join(
  "packages",
  "workbench-app",
  "src",
  "lib",
  "app",
  "discover",
  "content",
  "news.ts",
);

/** Stamp pending Discover announcements as part of the release commit. */
export async function stampPendingDiscoverRelease(rootDirectory, version) {
  assertReleaseVersion(version);
  const catalogPath = join(rootDirectory, NEWS_CATALOG_PATH);
  const source = await readFile(catalogPath, "utf8");
  const count = source.split(PENDING_RELEASE).length - 1;
  if (count === 0) return { count: 0, changedPath: undefined };

  const stamped = source.replaceAll(
    PENDING_RELEASE,
    `releasedIn: "${version}"`,
  );
  await writeFile(catalogPath, stamped);
  return {
    count,
    changedPath: relative(rootDirectory, catalogPath),
  };
}

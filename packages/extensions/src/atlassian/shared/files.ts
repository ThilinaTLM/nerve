import { extname } from "node:path";
import { isArtifactName } from "@nervekit/extension-api/host";

/**
 * An artifact name for a foreign file name (an attachment title): kept as is
 * when valid, otherwise folders, control and other unsupported characters
 * become `_`, leading dots are dropped and the extension survives truncation.
 */
export function artifactNameFor(filename: string, fallback = "attachment") {
  if (isArtifactName(filename)) return filename;
  const extension = extname(filename).replace(/[^\p{L}\p{N}.]/gu, "");
  const stem = filename
    .slice(0, filename.length - extname(filename).length)
    .replace(/[^\p{L}\p{N} ._-]+/gu, "_")
    .replace(/^[. _-]+/, "")
    .trimEnd();
  const kept = extension.slice(-20);
  const name = `${stem.slice(0, 128 - kept.length)}${kept}`.trimEnd();
  return isArtifactName(name) ? name : fallback;
}

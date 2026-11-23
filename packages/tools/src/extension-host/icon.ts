import {
  extensionFileLimits,
  extensionLucideIconSchema,
  type ExtensionIcon,
} from "@nervekit/contracts/extensions";
import type { ExtensionDefinition } from "@nervekit/extension-api";

/**
 * Resolves an extension's declared `icon`: a lucide name from the allowed set, or the path of an
 * SVG file (`*.svg`) read through the host's asset reader. Throws, naming the extension, on an
 * unknown name or a file that is not a small, square, self-contained SVG.
 */
export function resolveExtensionIcon(
  definition: Pick<ExtensionDefinition, "id" | "icon">,
  readAsset?: (extensionId: string, file: string) => string,
): ExtensionIcon {
  const { id, icon } = definition;
  if (!icon.endsWith(".svg")) {
    const parsed = extensionLucideIconSchema.safeParse(icon);
    if (!parsed.success)
      throw new Error(
        `${id}: unknown icon '${icon}'. Use one of ${extensionLucideIconSchema.options.join(", ")}, or a relative path ending in .svg.`,
      );
    return { type: "lucide", name: parsed.data };
  }
  if (!readAsset)
    throw new Error(`${id}: no assets are bundled (icon '${icon}').`);
  let svg: string;
  try {
    svg = readAsset(id, icon);
  } catch (error) {
    throw new Error(
      `${id}: cannot read icon '${icon}': ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const problem = svgProblem(svg);
  if (problem) throw new Error(`${id}: icon '${icon}' ${problem}.`);
  return { type: "svg", src: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

/** Why `svg` is not an acceptable extension icon, or undefined. */
export function svgProblem(svg: string): string | undefined {
  if (Buffer.byteLength(svg, "utf8") > extensionFileLimits.iconBytes)
    return `is larger than ${extensionFileLimits.iconBytes / 1024} KB`;
  // Comments could hide markup from these checks; an icon needs none.
  if (svg.includes("<!--")) return "must not contain comments";
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return "has no <svg> root";
  const viewBox = /\sviewBox\s*=\s*["']([^"']*)["']/i.exec(root[0])?.[1];
  const parts = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !parts ||
    parts.length !== 4 ||
    parts.some((n) => !Number.isFinite(n)) ||
    !(parts[2] > 0) ||
    parts[2] !== parts[3]
  )
    return "needs a square viewBox";
  if (/<\s*(script|foreignObject|image)\b/i.test(svg))
    return "must not contain <script>, <foreignObject> or <image>";
  if (/\son[a-z]+\s*=/i.test(svg)) return "must not contain event attributes";
  for (const match of svg.matchAll(
    /\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi,
  ))
    if (!match[1].trim().startsWith("#"))
      return "must not reference anything outside the file";
  for (const match of svg.matchAll(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi))
    if (!match[2].trim().startsWith("#"))
      return "must not reference anything outside the file";
  if (/@import/i.test(svg)) return "must not use @import";
  return undefined;
}

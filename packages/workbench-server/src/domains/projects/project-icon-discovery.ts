import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, posix, resolve } from "node:path";
import { imageDimensions, iconMimeType } from "./project-icon-image.js";
import {
  SKIPPED_DIRECTORIES,
  VISIBLE_DOT_DIRECTORIES,
  PENALIZED_DIRECTORIES,
  BRAND_DIRECTORIES,
  ICON_DIRECTORIES,
  NEUTRAL_TOKENS,
  VARIANT_TOKENS,
  THEME_TOKENS,
  THIRD_PARTY_TOKENS,
  TEMPLATE_STEMS,
  PLAIN_ICON_STEMS,
} from "./project-icon-vocabulary.js";

/**
 * Ranks every plausible project icon instead of taking the first file that
 * matches a fixed lookup order. Icons a project declares (web manifests, HTML
 * `<link rel=icon>`, extension/Tauri/Electron/Expo/Xcode/Linux desktop
 * metadata) outrank filename guesses; filename guesses are scored by icon
 * vocabulary, project-name matches, location and variant hints.
 */

const MAX_WALK_DEPTH = 5;
const MAX_WALK_DIRECTORIES = 768;
const MAX_WALK_IMAGES = 1_024;
const MAX_DECLARATION_FILES = 64;
const MAX_DECLARATION_BYTES = 256 * 1024;

const DECLARED_SCORE = 70;
const UNUSABLE_SCORE = -1_000;

const WEB_ROOT_DIRECTORIES = ["public", "static"] as const;

export interface IconCandidate {
  path: string;
  score: number;
}

export type ReadProjectFile = (
  relativePath: string,
  maxBytes: number,
) => Promise<Buffer | undefined>;

interface WalkedImage {
  path: string;
  directory: string;
  stem: string;
  depth: number;
}

interface WalkResult {
  images: WalkedImage[];
  declarations: string[];
}

/** All candidates, best first. Paths are root-relative POSIX paths. */
export async function rankIconCandidates(
  root: string,
  read: ReadProjectFile,
): Promise<IconCandidate[]> {
  const walk = await walkProject(root);
  const projectNames = await readProjectNames(root, read);
  const declared = new Map<string, number>();
  const declaredStems = new Set<string>();
  const declare = (path: string | undefined, bonus = 0): void => {
    if (!path || !iconMimeType(path)) return;
    const score = DECLARED_SCORE + bonus;
    declared.set(path, Math.max(declared.get(path) ?? -Infinity, score));
  };

  for (const file of walk.declarations.slice(0, MAX_DECLARATION_FILES)) {
    const contents = await read(file, MAX_DECLARATION_BYTES);
    if (!contents) continue;
    readDeclaration(file, contents.toString("utf8"), declare, declaredStems);
  }

  const qualifying = walk.images
    .map((image) => ({
      image,
      name: scoreName(image.stem, projectNames),
    }))
    .filter(
      ({ image, name }) => name.qualifies || declaredStems.has(image.stem),
    );
  const crowdedDirectories = crowdedIconDirectories(
    qualifying.map(({ image }) => image.directory),
  );

  const scores = new Map<string, number>();
  for (const { image, name } of qualifying) {
    let score = name.score + directoryScore(image.path) + formatScore(image);
    if (declaredStems.has(image.stem)) score += DECLARED_SCORE;
    if (crowdedDirectories.has(image.directory) && name.extras > 0) {
      score -= 10;
    }
    scores.set(image.path, score);
  }
  for (const [path, bonus] of declared) {
    const stem = stemOf(path);
    const name = scoreName(stem, projectNames);
    // Declared files may have arbitrary names; only templates are vetoed.
    const nameScore =
      name.score === UNUSABLE_SCORE ? UNUSABLE_SCORE : Math.max(name.score, 0);
    const score =
      bonus + nameScore + directoryScore(path) + formatScore({ path });
    scores.set(path, Math.max(scores.get(path) ?? -Infinity, score));
  }

  return [...scores]
    .map(([path, score]) => ({ path, score }))
    .filter((candidate) => candidate.score > UNUSABLE_SCORE / 2)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.split("/").length - right.path.split("/").length ||
        left.path.localeCompare(right.path),
    );
}

/** Score adjustment once the candidate bytes (and so its shape) are known. */
export function dimensionScore(buffer: Buffer, path: string): number {
  const size = imageDimensions(buffer, path);
  if (!size) return 0;
  const shortSide = Math.min(size.width, size.height);
  const ratio = Math.max(size.width, size.height) / Math.max(shortSide, 1);
  let score = 0;
  if (ratio > 1.3) score -= 20;
  if (path.toLowerCase().endsWith(".svg")) return score;
  if (shortSide < 32) score -= 12;
  else if (shortSide >= 64) score += 4;
  return score;
}

async function walkProject(root: string): Promise<WalkResult> {
  const images: WalkedImage[] = [];
  const declarations: Array<{ path: string; depth: number }> = [];
  const queue: Array<{ directory: string; depth: number }> = [
    { directory: "", depth: 0 },
  ];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_WALK_DIRECTORIES) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    let entries: Dirent<string>[];
    try {
      entries = await readdir(resolve(root, current.directory), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = current.directory
        ? `${current.directory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        if (current.depth < MAX_WALK_DEPTH && isWalkableDirectory(entry.name)) {
          queue.push({ directory: path, depth: current.depth + 1 });
        }
      } else if (entry.isFile()) {
        if (isDeclarationFile(path)) {
          declarations.push({ path, depth: current.depth });
        } else if (
          iconMimeType(entry.name) &&
          images.length < MAX_WALK_IMAGES
        ) {
          images.push({
            path,
            directory: current.directory,
            stem: stemOf(entry.name),
            depth: current.depth,
          });
        }
      }
    }
  }
  return {
    images,
    declarations: declarations
      .sort((left, right) => left.depth - right.depth)
      .map((declaration) => declaration.path),
  };
}

function isWalkableDirectory(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".")) return VISIBLE_DOT_DIRECTORIES.has(lower);
  // Build output variants such as `dist-e2e` or `build_release`.
  if (/^(?:dist|build|out)[-_.]/.test(lower)) return false;
  return !SKIPPED_DIRECTORIES.has(lower);
}

function isDeclarationFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    name.endsWith(".webmanifest") ||
    name === "manifest.json" ||
    name === "index.html" ||
    name === "app.html" ||
    name === "package.json" ||
    name === "tauri.conf.json" ||
    name === "app.json" ||
    name === "app.config.json" ||
    name.endsWith(".desktop") ||
    (name === "contents.json" && /\.appiconset$/i.test(posix.dirname(path)))
  );
}

async function readProjectNames(
  root: string,
  read: ReadProjectFile,
): Promise<string[]> {
  const names = [basename(root)];
  const packageJson = await read("package.json", MAX_DECLARATION_BYTES);
  const packageName = parseJson(packageJson?.toString("utf8"))?.name;
  if (typeof packageName === "string") {
    names.push(packageName.replace(/^@[^/]+\//, ""));
  }
  for (const manifest of ["Cargo.toml", "pyproject.toml"]) {
    const source = (await read(manifest, MAX_DECLARATION_BYTES))?.toString(
      "utf8",
    );
    const name = source && /^\s*name\s*=\s*["']([^"']+)["']/m.exec(source)?.[1];
    if (name) names.push(name);
  }
  return [...new Set(names.map(compact).filter((name) => name.length >= 3))];
}

interface NameScore {
  qualifies: boolean;
  score: number;
  /** Tokens that neither describe an icon nor name the project. */
  extras: number;
}

function scoreName(stem: string, projectNames: string[]): NameScore {
  const compactStem = compact(stem);
  if (TEMPLATE_STEMS.has(compactStem)) {
    return { qualifies: false, score: UNUSABLE_SCORE, extras: 0 };
  }
  const tokens = tokenize(stem);
  let score = 0;
  let qualifies = false;

  const projectName = projectNames
    .filter((name) => compactStem.includes(name))
    .sort((left, right) => right.length - left.length)[0];
  let nameEnd = -1;
  if (projectName) {
    score += 30;
    qualifies = true;
    nameEnd = compactStem.indexOf(projectName) + projectName.length;
  }

  const vocabularyScore = iconVocabularyScore(compactStem, tokens);
  if (vocabularyScore > 0) {
    score += vocabularyScore;
    qualifies = true;
  }
  if (!qualifies) return { qualifies, score: 0, extras: 0 };

  // Tokens before a matched project name are reverse-DNS or org prefixes
  // (`dev.example.app`); tokens of the project name itself are not variants.
  let extras = 0;
  let foreignPenalty = 0;
  let offset = 0;
  for (const token of tokens) {
    const start = compactStem.indexOf(token, offset);
    offset = start >= 0 ? start + token.length : offset;
    if (projectName && (start < nameEnd || projectName.includes(token))) {
      continue;
    }
    if (NEUTRAL_TOKENS.has(token)) continue;
    if (/^\d+$/.test(token)) {
      const size = Number(token);
      if (size <= 4) continue; // @2x scale suffixes
      if (size < 32) score -= 10;
      else if (size >= 64) score += 3;
      continue;
    }
    extras += 1;
    if (THIRD_PARTY_TOKENS.has(token)) score -= 30;
    else if (VARIANT_TOKENS.has(token)) score -= 12;
    else if (THEME_TOKENS.has(token)) score -= 3;
    else foreignPenalty += 6;
  }
  score -= Math.min(foreignPenalty, 18);
  if (PLAIN_ICON_STEMS.has(compactStem)) extras = 0;
  return { qualifies, score, extras };
}

function iconVocabularyScore(compactStem: string, tokens: string[]): number {
  if (compactStem.includes("appletouchicon")) return 45;
  if (compactStem.includes("appicon") || tokens.includes("launcher")) return 42;
  if (tokens.includes("favicon")) return 40;
  if (tokens.includes("icon")) return 34;
  if (tokens.includes("logo") || tokens.includes("logomark")) return 28;
  if (tokens.includes("brand") || tokens.includes("mark")) return 18;
  return 0;
}

function directoryScore(path: string): number {
  const segments = path.toLowerCase().split("/").slice(0, -1);
  let score = -3 * segments.length;
  if (segments.some((segment) => PENALIZED_DIRECTORIES.has(segment))) {
    score -= 25;
  }
  if (segments.some((segment) => BRAND_DIRECTORIES.has(segment))) score += 10;
  if (segments.some((segment) => segment.endsWith(".appiconset"))) score += 10;
  if (segments.some((segment) => ICON_DIRECTORIES.has(segment))) score += 4;
  return score;
}

function formatScore(image: { path: string }): number {
  switch (posix.extname(image.path).toLowerCase()) {
    case ".svg":
      return 6;
    case ".png":
      return 4;
    case ".webp":
      return 3;
    case ".ico":
      return -2;
    default:
      return 0;
  }
}

/** Directories holding many icon-like files are UI icon sets, not branding. */
function crowdedIconDirectories(directories: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const directory of directories) {
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count >= 6)
      .map(([directory]) => directory),
  );
}

type Declare = (path: string | undefined, bonus?: number) => void;

function readDeclaration(
  file: string,
  source: string,
  declare: Declare,
  declaredStems: Set<string>,
): void {
  const name = basename(file).toLowerCase();
  const directory = posix.dirname(file) === "." ? "" : posix.dirname(file);
  if (name.endsWith(".html")) {
    readHtmlIcons(directory, name, source, declare);
  } else if (name.endsWith(".desktop")) {
    readDesktopEntry(directory, source, declare, declaredStems);
  } else {
    const json = parseJson(source);
    if (!json) return;
    if (name.endsWith(".webmanifest") || name === "manifest.json") {
      readManifestIcons(directory, json, declare);
    } else if (name === "package.json") {
      readPackageIcons(directory, json, declare);
    } else if (name === "tauri.conf.json") {
      const bundle =
        asRecord(json.bundle) ?? asRecord(asRecord(json.tauri)?.bundle);
      for (const icon of stringArray(bundle?.icon)) {
        declare(joinPath(directory, icon), sizeBonus(sizeFromName(icon)));
      }
    } else if (name === "app.json" || name === "app.config.json") {
      const icon = asRecord(json.expo)?.icon ?? json.icon;
      if (typeof icon === "string") declare(joinPath(directory, icon));
    } else if (name === "contents.json") {
      for (const image of recordArray(json.images)) {
        if (typeof image.filename !== "string") continue;
        const size = sizeFromSizes(image.size) * scaleOf(image.scale);
        declare(joinPath(directory, image.filename), sizeBonus(size));
      }
    }
  }
}

function readManifestIcons(
  directory: string,
  json: Record<string, unknown>,
  declare: Declare,
): void {
  const add = (src: unknown, size: number, purpose: unknown, index: number) => {
    if (typeof src !== "string") return;
    const purposeBonus =
      typeof purpose === "string" && !purpose.split(/\s+/).includes("any")
        ? -8
        : 0;
    for (const path of resolveWebPath(directory, src)) {
      declare(path, sizeBonus(size) + purposeBonus - index * 0.01);
    }
  };
  // Web app manifests use an array; browser extensions map sizes to paths.
  if (Array.isArray(json.icons)) {
    recordArray(json.icons).forEach((icon, index) =>
      add(icon.src, sizeFromSizes(icon.sizes), icon.purpose, index),
    );
  }
  for (const icons of [
    json.icons,
    asRecord(json.action)?.default_icon,
    asRecord(json.browser_action)?.default_icon,
  ]) {
    if (typeof icons === "string") add(icons, 0, undefined, 0);
    const record = Array.isArray(icons) ? undefined : asRecord(icons);
    for (const [size, src] of Object.entries(record ?? {})) {
      add(src, Number(size) || 0, undefined, 0);
    }
  }
}

function readHtmlIcons(
  directory: string,
  name: string,
  source: string,
  declare: Declare,
): void {
  for (const tag of source.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = htmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes("mask-icon")) continue;
    const isTouchIcon = rel.includes("apple-touch-icon");
    if (!isTouchIcon && !rel.includes("icon")) continue;
    let href = htmlAttribute(tag, "href");
    if (!href) continue;
    // SvelteKit serves `%sveltekit.assets%` from `static/` beside `src/`.
    let webRoots: string[] | undefined;
    if (href.startsWith("%sveltekit.assets%")) {
      webRoots = [joinPath(directory, "../static") ?? "static"];
      href = href.slice("%sveltekit.assets%".length);
    } else if (href.startsWith("%PUBLIC_URL%")) {
      webRoots = [directory];
      href = href.slice("%PUBLIC_URL%".length);
    }
    const size = sizeFromSizes(htmlAttribute(tag, "sizes"));
    const bonus =
      sizeBonus(size) + (isTouchIcon ? 2 : 0) + (name === "index.html" ? 1 : 0);
    for (const path of resolveWebPath(directory, href, webRoots)) {
      declare(path, bonus);
    }
  }
}

function readPackageIcons(
  directory: string,
  json: Record<string, unknown>,
  declare: Declare,
): void {
  // VS Code extensions declare `icon`; electron-builder uses `build.icon` and
  // otherwise looks in its `build/` resources directory.
  if (typeof json.icon === "string") declare(joinPath(directory, json.icon));
  const build = asRecord(json.build);
  if (!build) return;
  const icon = typeof build.icon === "string" ? build.icon : undefined;
  if (icon) {
    for (const base of [directory, joinPath(directory, "build")]) {
      const path = joinPath(base ?? "", icon);
      if (!path) continue;
      if (iconMimeType(path)) declare(path);
      else
        for (const extension of [".png", ".svg"])
          declare(`${path}${extension}`);
    }
  }
  for (const fallback of ["build/icon.png", "build/icon.svg"]) {
    declare(joinPath(directory, fallback), -10);
  }
}

function readDesktopEntry(
  directory: string,
  source: string,
  declare: Declare,
  declaredStems: Set<string>,
): void {
  const icon = /^Icon\s*=\s*(.+?)\s*$/m.exec(source)?.[1];
  if (!icon || icon.startsWith("/")) return;
  if (icon.includes("/") || iconMimeType(icon)) {
    declare(joinPath(directory, icon));
  } else {
    // Theme icon names are resolved by matching file stems found by the walk.
    declaredStems.add(icon);
  }
}

/** Resolve an href or manifest `src` the way a dev server would serve it. */
function resolveWebPath(
  directory: string,
  href: string,
  webRoots?: string[],
): string[] {
  const clean = href.split(/[?#]/, 1)[0]?.replaceAll("\\", "/") ?? "";
  if (!clean || /[%{}$\0]/.test(clean)) return [];
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith("//")) return [];
  if (!clean.startsWith("/")) {
    const path = joinPath(directory, clean);
    return path ? [path] : [];
  }
  const inWebRoot = WEB_ROOT_DIRECTORIES.some(
    (root) => directory === root || directory.endsWith(`/${root}`),
  );
  const roots =
    webRoots ??
    (inWebRoot
      ? [directory]
      : [
          ...WEB_ROOT_DIRECTORIES.map(
            (root) => joinPath(directory, root) ?? root,
          ),
          directory,
        ]);
  return roots.flatMap((root) => joinPath(root, clean.slice(1)) ?? []);
}

function joinPath(directory: string, path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\0")) return undefined;
  const joined = posix.normalize(posix.join(directory || ".", path));
  return joined === "." || joined.startsWith("..") ? undefined : joined;
}

function htmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function sizeBonus(size: number): number {
  if (size === Number.POSITIVE_INFINITY) return 6;
  if (size <= 0) return 0;
  if (size < 32) return -10;
  if (size >= 180) return 6;
  return size >= 64 ? 4 : 0;
}

function sizeFromSizes(sizes: unknown): number {
  if (typeof sizes !== "string") return 0;
  let largest = 0;
  for (const size of sizes.toLowerCase().split(/\s+/)) {
    if (size === "any") return Number.POSITIVE_INFINITY;
    const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size);
    if (match && match[1] === match[2])
      largest = Math.max(largest, Number(match[1]));
  }
  return largest;
}

function sizeFromName(path: string): number {
  const match = /(\d+)x\1(?:@(\d)x)?/.exec(basename(path));
  return match ? Number(match[1]) * Number(match[2] ?? 1) : 0;
}

function scaleOf(scale: unknown): number {
  const value = typeof scale === "string" ? Number.parseFloat(scale) : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function stemOf(path: string): string {
  const name = basename(path);
  const extension = posix.extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(stem: string): string[] {
  return stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((part) => part.match(/[a-z]+|\d+/g) ?? []);
}

function parseJson(
  source: string | undefined,
): Record<string, unknown> | undefined {
  if (!source) return undefined;
  try {
    return asRecord(JSON.parse(source));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

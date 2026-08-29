import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { realpath, readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { resizeImage, type ResizedImage } from "@nervekit/harness/node";

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const ICON_MAX_DIMENSION = 96;
const MAX_DISCOVERY_DEPTH = 4;
const MAX_DISCOVERY_DIRECTORIES = 512;
const MAX_DISCOVERY_CANDIDATES = 256;

const MANIFEST_PATHS = [
  "manifest.webmanifest",
  "manifest.json",
  "public/manifest.webmanifest",
  "public/manifest.json",
  "static/manifest.webmanifest",
  "static/manifest.json",
] as const;

const CANDIDATE_DIRECTORIES = [
  "app",
  "src/app",
  "",
  "public",
  "static",
  "assets",
  "src/assets",
] as const;

const CANDIDATE_NAMES = [
  "apple-touch-icon",
  "favicon",
  "app-icon",
  "icon",
  "logo",
] as const;

const EXTENSION_PRIORITY = [
  ".svg",
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".ico",
] as const;

const MIME_BY_EXTENSION = new Map<string, string>([
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".coverage",
  ".cache",
  "cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".vite",
  "test-artifacts",
  "test-results",
  "playwright-report",
]);

export interface ProjectIcon {
  buffer: Buffer;
  mimeType: string;
  etag: string;
}

type ResizeImage = (
  source: Buffer,
  mimeType: string,
  maxDimension: number,
) => Promise<ResizedImage>;

type CacheEntry = {
  expiresAt: number;
  value: Promise<ProjectIcon | undefined>;
};

export interface ProjectIconServiceOptions {
  now?: () => number;
  resize?: ResizeImage;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

interface ManifestIcon {
  src?: unknown;
  sizes?: unknown;
  purpose?: unknown;
}

interface ManifestDocument {
  icons?: unknown;
}

export class ProjectIconService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly resize: ResizeImage;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;

  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
    options: ProjectIconServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.resize = options.resize ?? resizeImage;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  get(projectId: string): Promise<ProjectIcon | undefined> {
    // Validate the project even when a stale cache key happens to remain after
    // project removal.
    const project = this.getProject(projectId);
    const now = this.now();
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > now) {
      this.cache.delete(projectId);
      this.cache.set(projectId, cached);
      return cached.value;
    }
    if (cached) this.cache.delete(projectId);

    const value = this.discover(project.dir).catch((error: unknown) => {
      this.cache.delete(projectId);
      throw error;
    });
    this.cache.set(projectId, {
      expiresAt: now + this.cacheTtlMs,
      value,
    });
    this.evictOverflow();
    return value;
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.cache.delete(oldestKey);
    }
  }

  private async discover(projectDir: string): Promise<ProjectIcon | undefined> {
    let root: string;
    try {
      root = await realpath(projectDir);
    } catch {
      return undefined;
    }
    const candidates = [
      ...(await manifestCandidates(root)),
      ...(await conventionalCandidates(root)),
      ...(await nestedIconCandidates(root)),
    ];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const loaded = await loadCandidate(root, candidate);
      if (!loaded) continue;

      let image = loaded;
      try {
        const resized = await this.resize(
          loaded.buffer,
          loaded.mimeType,
          ICON_MAX_DIMENSION,
        );
        image = { buffer: resized.buffer, mimeType: resized.mimeType };
      } catch {
        // ICO and some unusual but browser-supported images may not be
        // understood by the native normalizer. The capped original is safe to
        // serve and the browser can decide whether it is renderable.
      }

      return {
        ...image,
        etag: `"${createHash("sha256").update(image.buffer).digest("hex").slice(0, 24)}"`,
      };
    }
    return undefined;
  }
}

async function manifestCandidates(root: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const manifestPath of MANIFEST_PATHS) {
    const manifest = await readSmallContainedFile(
      root,
      manifestPath,
      MAX_MANIFEST_BYTES,
    );
    if (!manifest) continue;
    try {
      const document = JSON.parse(
        manifest.toString("utf8"),
      ) as ManifestDocument;
      if (!Array.isArray(document.icons)) continue;
      const icons = document.icons
        .filter(isManifestIcon)
        .map((icon, index) => ({
          path: resolveManifestIconPath(manifestPath, icon.src),
          purposeRank: manifestPurposeRank(icon.purpose),
          sizeRank: manifestSizeRank(icon.sizes),
          index,
        }))
        .filter(
          (icon): icon is typeof icon & { path: string } =>
            icon.path !== undefined,
        )
        .sort(
          (left, right) =>
            right.purposeRank - left.purposeRank ||
            right.sizeRank - left.sizeRank ||
            left.index - right.index,
        );
      candidates.push(...icons.map((icon) => icon.path));
    } catch {
      // A malformed manifest should not prevent conventional icon discovery.
    }
  }
  return candidates;
}

function isManifestIcon(
  value: unknown,
): value is ManifestIcon & { src: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ManifestIcon).src === "string"
  );
}

function resolveManifestIconPath(
  manifestPath: string,
  source: string,
): string | undefined {
  const cleanSource = source.split(/[?#]/, 1)[0]?.replaceAll("\\", "/");
  if (!cleanSource || cleanSource.includes("\0")) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(cleanSource) || cleanSource.startsWith("//")) {
    return undefined;
  }

  const manifestDirectory = manifestPath.includes("/")
    ? manifestPath.slice(0, manifestPath.lastIndexOf("/"))
    : "";
  const webRoot = ["public", "static"].includes(manifestDirectory)
    ? manifestDirectory
    : "";
  const relativeSource = cleanSource.startsWith("/")
    ? `${webRoot}/${cleanSource.slice(1)}`
    : `${manifestDirectory}/${cleanSource}`;
  const normalized = relativeSource.split("/").filter(Boolean).join("/");
  return isAllowedRelativePath(normalized) &&
    MIME_BY_EXTENSION.has(extname(normalized).toLowerCase())
    ? normalized
    : undefined;
}

function manifestPurposeRank(purpose: unknown): number {
  if (typeof purpose !== "string" || purpose.trim() === "") return 2;
  return purpose.split(/\s+/).includes("any") ? 2 : 1;
}

function manifestSizeRank(sizes: unknown): number {
  if (typeof sizes !== "string") return 0;
  if (sizes.split(/\s+/).includes("any")) return Number.MAX_SAFE_INTEGER;
  let largest = 0;
  for (const size of sizes.split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width === height) largest = Math.max(largest, width);
  }
  return largest;
}

async function conventionalCandidates(root: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const directory of CANDIDATE_DIRECTORIES) {
    let names: string[];
    try {
      names = await readdir(resolve(root, directory));
    } catch {
      continue;
    }
    const byLowerName = new Map(
      names.map((name) => [name.toLowerCase(), name]),
    );
    for (const baseName of CANDIDATE_NAMES) {
      for (const extension of EXTENSION_PRIORITY) {
        const actualName = byLowerName.get(`${baseName}${extension}`);
        if (actualName) {
          candidates.push(
            directory ? `${directory}/${actualName}` : actualName,
          );
        }
      }
    }
  }
  return candidates;
}

async function nestedIconCandidates(root: string): Promise<string[]> {
  const candidates: string[] = [];
  const queue: Array<{ directory: string; depth: number }> = [
    { directory: "", depth: 0 },
  ];
  let visitedDirectories = 0;

  while (
    queue.length > 0 &&
    visitedDirectories < MAX_DISCOVERY_DIRECTORIES &&
    candidates.length < MAX_DISCOVERY_CANDIDATES
  ) {
    const current = queue.shift();
    if (!current) break;
    visitedDirectories += 1;

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
      const relativePath = current.directory
        ? `${current.directory}/${entry.name}`
        : entry.name;
      if (entry.isFile() && isLikelyIconName(entry.name)) {
        candidates.push(relativePath);
        if (candidates.length >= MAX_DISCOVERY_CANDIDATES) break;
      } else if (
        entry.isDirectory() &&
        current.depth < MAX_DISCOVERY_DEPTH &&
        !EXCLUDED_SEGMENTS.has(entry.name.toLowerCase())
      ) {
        queue.push({ directory: relativePath, depth: current.depth + 1 });
      }
    }
  }

  return candidates;
}

function isLikelyIconName(name: string): boolean {
  const extension = extname(name).toLowerCase();
  if (!MIME_BY_EXTENSION.has(extension)) return false;
  const stem = name.slice(0, -extension.length).toLowerCase();
  return /(?:^|[-_.])(apple-touch-icon|favicon|app-icon|icon|logo|mark)(?:$|[-_.])/.test(
    stem,
  );
}

async function loadCandidate(
  root: string,
  candidate: string,
): Promise<{ buffer: Buffer; mimeType: string } | undefined> {
  const extension = extname(candidate).toLowerCase();
  const mimeType = MIME_BY_EXTENSION.get(extension);
  if (!mimeType || !isAllowedRelativePath(candidate)) return undefined;
  const buffer = await readSmallContainedFile(root, candidate, MAX_ICON_BYTES);
  return buffer && isPlausibleImage(buffer, extension)
    ? { buffer, mimeType }
    : undefined;
}

function isPlausibleImage(buffer: Buffer, extension: string): boolean {
  switch (extension) {
    case ".png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case ".jpg":
    case ".jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    case ".webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );
    case ".ico":
      return (
        buffer.length >= 6 &&
        buffer[0] === 0 &&
        buffer[1] === 0 &&
        buffer[2] === 1 &&
        buffer[3] === 0
      );
    case ".svg": {
      const source = buffer.subarray(0, 64 * 1024).toString("utf8");
      return (
        /<svg(?:\s|>)/i.test(source) &&
        !/<(?:script|foreignObject)(?:\s|>)/i.test(source) &&
        !/\son[a-z]+\s*=/i.test(source) &&
        !/(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(source)
      );
    }
    default:
      return false;
  }
}

async function readSmallContainedFile(
  root: string,
  candidate: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (!isAllowedRelativePath(candidate)) return undefined;
  const path = resolve(root, candidate);
  if (!isInside(root, path)) return undefined;
  try {
    const resolvedPath = await realpath(path);
    if (!isInside(root, resolvedPath)) return undefined;
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) {
      return undefined;
    }
    return await readFile(resolvedPath);
  } catch {
    return undefined;
  }
}

function isAllowedRelativePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\0")) return false;
  const segments = path.replaceAll("\\", "/").split("/");
  return !segments.some(
    (segment) =>
      segment === ".." || EXCLUDED_SEGMENTS.has(segment.toLowerCase()),
  );
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

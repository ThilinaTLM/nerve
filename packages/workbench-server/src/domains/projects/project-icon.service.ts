import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Project } from "@nervekit/contracts/core";
import { resizeImage, type ResizedImage } from "@nervekit/harness/node";
import {
  dimensionScore,
  rankIconCandidates,
  type ReadProjectFile,
} from "./project-icon-discovery.js";
import {
  iconMimeType,
  isPlausibleImage,
  maxIconBytes,
} from "./project-icon-image.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const ICON_MAX_DIMENSION = 96;
/** Top-ranked loadable candidates re-scored once their shape is known. */
const SHORTLIST_SIZE = 12;
/** A project can pin its icon; this wins over every discovered candidate. */
const OVERRIDE_PATHS = [".svg", ".png", ".webp", ".jpg", ".jpeg", ".ico"].map(
  (extension) => `.nerve/icon${extension}`,
);

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

export class ProjectIconService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly resize: ResizeImage;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;

  constructor(
    private readonly getProject: (projectId: string) => Project,
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

    const value = this.discover(project.directory).catch((error: unknown) => {
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
      const oldestKey = this.cache.keys().next().value;
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
    const read = (path: string, maxBytes: number) =>
      readSmallContainedFile(root, path, maxBytes);

    for (const path of OVERRIDE_PATHS) {
      const loaded = await loadCandidate(read, path);
      if (loaded) return this.normalize(loaded);
    }

    let best: { image: LoadedImage; score: number } | undefined;
    let shortlisted = 0;
    for (const candidate of await rankIconCandidates(root, read)) {
      if (shortlisted >= SHORTLIST_SIZE) break;
      const loaded = await loadCandidate(read, candidate.path);
      if (!loaded) continue;
      shortlisted += 1;
      const score =
        candidate.score + dimensionScore(loaded.buffer, candidate.path);
      if (!best || score > best.score) best = { image: loaded, score };
    }
    return best ? this.normalize(best.image) : undefined;
  }

  private async normalize(loaded: LoadedImage): Promise<ProjectIcon> {
    let image = loaded;
    try {
      const resized = await this.resize(
        loaded.buffer,
        loaded.mimeType,
        ICON_MAX_DIMENSION,
      );
      image = { buffer: resized.buffer, mimeType: resized.mimeType };
    } catch {
      // SVG, ICO and some unusual but browser-supported images are not
      // understood by the native normalizer. The capped original is safe to
      // serve and the browser can decide whether it is renderable.
    }
    return {
      ...image,
      etag: `"${createHash("sha256").update(image.buffer).digest("hex").slice(0, 24)}"`,
    };
  }
}

interface LoadedImage {
  buffer: Buffer;
  mimeType: string;
}

async function loadCandidate(
  read: ReadProjectFile,
  path: string,
): Promise<LoadedImage | undefined> {
  const mimeType = iconMimeType(path);
  if (!mimeType) return undefined;
  const buffer = await read(path, maxIconBytes(path));
  return buffer && isPlausibleImage(buffer, path)
    ? { buffer, mimeType }
    : undefined;
}

async function readSmallContainedFile(
  root: string,
  candidate: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (!candidate || isAbsolute(candidate) || candidate.includes("\0")) {
    return undefined;
  }
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

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

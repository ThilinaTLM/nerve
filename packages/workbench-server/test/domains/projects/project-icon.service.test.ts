import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import {
  ProjectIconService,
  type ProjectIcon,
} from "../../../src/domains/projects/project-icon.service.js";
import { createAuthenticatedApp } from "../../helpers/server-routes.js";

const roots: string[] = [];
const unchangedResize = async (buffer: Buffer, mimeType: string) => ({
  buffer,
  mimeType,
  changed: false,
});

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ]);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectDirectory(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `nerve-project-icon-${name}-`));
  roots.push(root);
  return root;
}

function project(id: string, dir: string): ProjectRecord {
  return {
    id,
    name: id,
    dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function serviceFor(
  projects: ProjectRecord[],
  options: ConstructorParameters<typeof ProjectIconService>[1] = {},
): ProjectIconService {
  const byId = new Map(projects.map((candidate) => [candidate.id, candidate]));
  return new ProjectIconService(
    (projectId) => {
      const found = byId.get(projectId);
      if (!found) throw new Error(`Unknown project ${projectId}`);
      return found;
    },
    { resize: unchangedResize, ...options },
  );
}

async function write(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

async function icon(
  service: ProjectIconService,
  projectId: string,
): Promise<ProjectIcon> {
  const result = await service.get(projectId);
  assert.ok(result);
  return result;
}

describe("ProjectIconService", () => {
  it("prefers the best manifest icon over conventional files", async () => {
    const dir = await projectDirectory("manifest");
    await write(
      join(dir, "public/manifest.webmanifest"),
      JSON.stringify({
        icons: [
          { src: "/icons/mask.png", sizes: "512x512", purpose: "maskable" },
          { src: "/icons/small.png", sizes: "64x64", purpose: "any" },
          { src: "/icons/large.png", sizes: "192x192", purpose: "any" },
        ],
      }),
    );
    await write(join(dir, "public/icons/mask.png"), png("mask"));
    await write(join(dir, "public/icons/small.png"), png("small"));
    await write(join(dir, "public/icons/large.png"), png("large"));
    await write(join(dir, "favicon.svg"), "<svg></svg>");

    const result = await icon(
      serviceFor([project("proj_manifest", dir)]),
      "proj_manifest",
    );
    assert.ok(result.buffer.equals(png("large")));
    assert.equal(result.mimeType, "image/png");
    assert.match(result.etag, /^"[a-f\d]{24}"$/);
  });

  it("matches conventional filenames case-insensitively and falls through oversized candidates", async () => {
    const dir = await projectDirectory("conventional");
    await write(join(dir, "app/apple-touch-icon.svg"), "not-an-image");
    await write(join(dir, "app/icon.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
    await write(join(dir, "public/FAVICON.SVG"), "<svg>svg-icon</svg>");

    const result = await icon(
      serviceFor([project("proj_conventional", dir)]),
      "proj_conventional",
    );
    assert.equal(result.buffer.toString(), "<svg>svg-icon</svg>");
    assert.equal(result.mimeType, "image/svg+xml");
  });

  it("finds branded icons in nested workspace apps", async () => {
    const dir = await projectDirectory("nested-workspace");
    await write(
      join(dir, "packages/client/public/acme-logo-dark.svg"),
      "<svg>nested-logo</svg>",
    );

    const result = await icon(
      serviceFor([project("proj_nested", dir)]),
      "proj_nested",
    );
    assert.equal(result.buffer.toString(), "<svg>nested-logo</svg>");
  });

  it("bounds nested discovery and excludes dependency, build, and test output", async () => {
    const dir = await projectDirectory("bounded");
    await write(join(dir, "node_modules/icon.png"), png("dependency"));
    await write(join(dir, "dist/favicon.png"), png("build"));
    await write(join(dir, "test-artifacts/logo.png"), png("test-output"));
    await write(join(dir, "one/two/three/four/five/logo.png"), png("too-deep"));

    assert.equal(
      await serviceFor([project("proj_bounded", dir)]).get("proj_bounded"),
      undefined,
    );
  });

  it("rejects manifest icons that escape through a symlink", async () => {
    const dir = await projectDirectory("symlink");
    const outside = await projectDirectory("outside");
    await write(join(outside, "icon.png"), png("outside"));
    await symlink(outside, join(dir, "public"), "dir");
    await write(
      join(dir, "manifest.webmanifest"),
      JSON.stringify({ icons: [{ src: "public/icon.png", sizes: "128x128" }] }),
    );

    assert.equal(
      await serviceFor([project("proj_symlink", dir)]).get("proj_symlink"),
      undefined,
    );
  });

  it("caches hits and misses until the TTL expires", async () => {
    const hitDir = await projectDirectory("hit-cache");
    const missDir = await projectDirectory("miss-cache");
    await write(join(hitDir, "icon.png"), png("cached"));
    let now = 100;
    const service = serviceFor(
      [project("proj_hit", hitDir), project("proj_miss", missDir)],
      { now: () => now, cacheTtlMs: 1_000 },
    );

    const firstHit = await icon(service, "proj_hit");
    await rm(join(hitDir, "icon.png"));
    assert.equal((await icon(service, "proj_hit")).etag, firstHit.etag);

    assert.equal(await service.get("proj_miss"), undefined);
    await write(join(missDir, "logo.png"), png("appeared"));
    assert.equal(await service.get("proj_miss"), undefined);

    now += 1_001;
    assert.equal(await service.get("proj_hit"), undefined);
    assert.ok(
      (await icon(service, "proj_miss")).buffer.equals(png("appeared")),
    );
  });

  it("deduplicates concurrent normalization and bounds the cache", async () => {
    const firstDir = await projectDirectory("dedupe-first");
    const secondDir = await projectDirectory("dedupe-second");
    await write(join(firstDir, "icon.png"), png("first"));
    await write(join(secondDir, "icon.png"), png("second"));
    let resizeCalls = 0;
    const service = serviceFor(
      [project("proj_first", firstDir), project("proj_second", secondDir)],
      {
        maxCacheEntries: 1,
        resize: async (buffer, mimeType) => {
          resizeCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { buffer, mimeType, changed: false };
        },
      },
    );

    const [left, right] = await Promise.all([
      service.get("proj_first"),
      service.get("proj_first"),
    ]);
    assert.equal(left?.etag, right?.etag);
    assert.equal(resizeCalls, 1);

    await service.get("proj_second");
    await rm(join(firstDir, "icon.png"));
    assert.equal(await service.get("proj_first"), undefined);
  });
});

describe("project icon route", () => {
  it("serves cached image responses, conditional requests, and misses", async () => {
    const dir = await projectDirectory("route");
    await write(
      join(dir, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>',
    );
    const { app, services, headers } = await createAuthenticatedApp();
    const created = await services.projectLifecycle.createProject({
      dir,
    });
    const path = `/api/projects/${created.id}/icon`;

    const unauthorized = await app.request(path);
    assert.equal(unauthorized.status, 401);

    const response = await app.request(path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(
      response.headers.get("cache-control"),
      "private, max-age=86400",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const etag = response.headers.get("etag");
    assert.ok(etag);

    const conditional = await app.request(path, {
      headers: { ...headers, "if-none-match": etag },
    });
    assert.equal(conditional.status, 304);

    const missingDir = await projectDirectory("route-missing");
    const missing = await services.projectLifecycle.createProject({
      dir: missingDir,
    });
    const notFound = await app.request(`/api/projects/${missing.id}/icon`, {
      headers,
    });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get("cache-control"), "private, no-cache");
  });
});

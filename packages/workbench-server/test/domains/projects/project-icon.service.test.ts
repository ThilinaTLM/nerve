import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Project } from "@nervekit/contracts/core";
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
  width: 1,
  height: 1,
});

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ]);
}

/** PNG signature plus an IHDR header so the intrinsic size is readable. */
function sizedPng(label: string, width: number, height: number): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([png(""), header, Buffer.from(label)]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root)));
});

async function projectDirectory(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `nerve-project-icon-${name}-`));
  roots.push(root);
  return root;
}

function project(id: string, dir: string): Project {
  return {
    id,
    name: id,
    directory: dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function serviceFor(
  projects: Project[],
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

  it("matches conventional filenames case-insensitively and falls through invalid candidates", async () => {
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
    await write(join(dir, "dist-e2e/favicon.png"), png("e2e-build"));
    await write(join(dir, ".venv/lib/logo.png"), png("hidden"));
    await write(
      join(dir, "one/two/three/four/five/six/logo.png"),
      png("too-deep"),
    );

    assert.equal(
      await serviceFor([project("proj_bounded", dir)]).get("proj_bounded"),
      undefined,
    );
  });

  it("pins the icon through .nerve/icon.* over discovered candidates", async () => {
    const dir = await projectDirectory("override");
    await write(join(dir, ".nerve/icon.png"), png("pinned"));
    await write(
      join(dir, "public/manifest.webmanifest"),
      JSON.stringify({ icons: [{ src: "/icon.png", sizes: "512x512" }] }),
    );
    await write(join(dir, "public/icon.png"), png("manifest"));

    const result = await icon(
      serviceFor([project("proj_override", dir)]),
      "proj_override",
    );
    assert.ok(result.buffer.equals(png("pinned")));
  });

  it("follows HTML icon links into the web root and vetoes scaffold placeholders", async () => {
    const dir = await projectDirectory("html");
    await write(
      join(dir, "web/index.html"),
      '<link rel="icon" type="image/svg+xml" href="/brand.svg?v=2">',
    );
    await write(join(dir, "web/public/brand.svg"), "<svg>declared</svg>");
    await write(join(dir, "logo.png"), png("guessed"));
    const scaffold = await projectDirectory("scaffold");
    await write(
      join(scaffold, "index.html"),
      '<link rel="icon" href="/vite.svg">',
    );
    await write(join(scaffold, "public/vite.svg"), "<svg>vite</svg>");
    const service = serviceFor([
      project("proj_html", dir),
      project("proj_scaffold", scaffold),
    ]);

    assert.equal(
      (await icon(service, "proj_html")).buffer.toString(),
      "<svg>declared</svg>",
    );
    assert.equal(await service.get("proj_scaffold"), undefined);
  });

  it("reads browser extension icon maps and prefers the largest size", async () => {
    const dir = await projectDirectory("extension");
    await write(
      join(dir, "extension/manifest.json"),
      JSON.stringify({
        icons: { "16": "icons/icon16.png", "128": "icons/icon128.png" },
      }),
    );
    await write(
      join(dir, "extension/icons/icon16.png"),
      sizedPng("16", 16, 16),
    );
    await write(
      join(dir, "extension/icons/icon128.png"),
      sizedPng("128", 128, 128),
    );

    const result = await icon(
      serviceFor([project("proj_extension", dir)]),
      "proj_extension",
    );
    assert.ok(result.buffer.equals(sizedPng("128", 128, 128)));
  });

  it("resolves Linux desktop icon names to the plain branded variant", async () => {
    const dir = await projectDirectory("desktop-entry");
    await write(
      join(dir, "packaging/linux/dev.example.kinema.desktop"),
      "[Desktop Entry]\nName=Kinema\nIcon=dev.example.kinema\n",
    );
    const brand = join(dir, "crates/desktop/assets/brand");
    await write(join(brand, "dev.example.kinema.svg"), "<svg>app</svg>");
    await write(join(brand, "dev.example.kinema-16.svg"), "<svg>16</svg>");
    await write(join(brand, "dev.example.kinema-symbolic.svg"), "<svg>s</svg>");
    await write(
      join(dir, "crates/desktop/assets/tmdb-logo.svg"),
      "<svg>3p</svg>",
    );

    const result = await icon(
      serviceFor([project("proj_desktop", dir)]),
      "proj_desktop",
    );
    assert.equal(result.buffer.toString(), "<svg>app</svg>");
  });

  it("ranks undeclared files by project name, variants and shape", async () => {
    const dir = await projectDirectory("ranking");
    await write(join(dir, "Cargo.toml"), '[package]\nname = "plantview"\n');
    await write(
      join(dir, "src/main/resources/icons/plantview.svg"),
      '<svg viewBox="0 0 64 64"></svg>',
    );
    await write(
      join(dir, "assets/logo.svg"),
      '<svg viewBox="0 0 400 100">wordmark</svg>',
    );
    await write(join(dir, "assets/github-logo.svg"), "<svg>github</svg>");
    await write(join(dir, "docs/favicon.png"), png("docs"));

    const result = await icon(
      serviceFor([project("proj_ranking", dir)]),
      "proj_ranking",
    );
    assert.equal(result.buffer.toString(), '<svg viewBox="0 0 64 64"></svg>');
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
          return { buffer, mimeType, changed: false, width: 1, height: 1 };
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
    const created = services.conversationCore.projects.create({
      name: "Icon project",
      directory: dir,
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
    const missing = services.conversationCore.projects.create({
      name: "Missing icon",
      directory: missingDir,
    });
    const notFound = await app.request(`/api/projects/${missing.id}/icon`, {
      headers,
    });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get("cache-control"), "private, no-cache");
  });
});

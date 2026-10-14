import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HtmlPreviewService } from "../../../src/domains/filesystem/html-preview.service.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "html-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "pages"));
  await writeFile(join(root, "pages/demo.htm"), "saved");
  await writeFile(join(root, "shared.css"), "body { color: red }");
  let directory = root;
  let now = 0;
  const service = new HtmlPreviewService(
    () => directory,
    () => now,
  );
  const input = {
    projectId: "p",
    path: "pages/demo.htm",
    text: "<h1>Draft</h1>",
  };
  return {
    root,
    service,
    input,
    setDirectory: (value: string) => {
      directory = value;
    },
    setTime: (value: number) => {
      now = value;
    },
  };
}
const origin = "http://localhost:43967";

test("injects parsed base/bootstrap first, strips navigation, and uses category-scoped sandbox CSP", async (t) => {
  const { service, input } = await fixture(t);
  const { id } = await service.create(
    {
      ...input,
      text: '<base href="https://evil.test"><meta HTTP-EQUIV="Refresh" content="0;url=https://evil.test"><script>authored()</script><a href="https://evil.test" ping="https://evil.test">link</a><template><base href="https://evil.test"><area href="x"></template>',
      approvals: [{ origin: "https://cdn.test", category: "style" }],
    },
    origin,
  );
  const response = await service.resource(id, undefined, origin);
  const html = await response.text();
  assert.match(
    html,
    new RegExp(`<head><base href="/html-preview/${id}/assets/pages/">`),
  );
  assert.ok(
    html.indexOf("securitypolicyviolation") < html.indexOf("authored()"),
  );
  assert.match(html, /nerve:html-preview-resource/);
  assert.doesNotMatch(html, /evil\.test|http-equiv|ping=/);
  const csp = response.headers.get("content-security-policy")!;
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin|frame-ancestors/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /img-src data: blob:/);
  assert.match(csp, /font-src data: blob:/);
  assert.match(csp, /style-src [^;]*https:\/\/cdn.test/);
  assert.doesNotMatch(csp, /script-src [^;]*cdn.test/);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("reads parent assets with explicit MIME, CORS and bounded content; rejects unsupported/traversing paths", async (t) => {
  const { service, input, root } = await fixture(t);
  const { id } = await service.create(input, origin);
  const response = await service.resource(id, "pages/../shared.css", origin);
  assert.equal(await response.text(), "body { color: red }");
  assert.equal(response.headers.get("content-type"), "text/css");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    await (await service.resource(id, "shared.css", origin, true)).text(),
    "",
  );
  for (const path of [
    "../shared.css",
    "%2e%2e/shared.css",
    "%2fetc/passwd.css",
    "C:/secret.css",
    "C:secret.css",
    "%00.css",
    "%ZZ.css",
    "pages/demo.htm",
    "secret.json",
    "dir",
    "a%5cb.css",
  ]) {
    await assert.rejects(service.resource(id, path, origin));
  }
  await writeFile(
    join(root, "image.svg"),
    "<svg><script>alert(1)</script></svg>",
  );
  const svg = await service.resource(id, "image.svg", origin);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(
    svg.headers.get("content-security-policy")!,
    /default-src 'none'; sandbox/,
  );
  await writeFile(join(root, "large.js"), "");
  await truncate(join(root, "large.js"), 10 * 1_024 * 1_024 + 1);
  await assert.rejects(service.resource(id, "large.js", origin));
  await mkdir(join(root, "directory.css"));
  await assert.rejects(service.resource(id, "directory.css", origin));
});

test("rejects symlink escapes and invalid document/approval inputs", async (t) => {
  const { service, input, root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "html-preview-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.css"), "secret");
  await writeFile(join(outside, "secret.html"), "secret");
  await symlink(outside, join(root, "escape"));
  await writeFile(join(root, ".env"), "SECRET=hidden");
  await symlink(join(root, ".env"), join(root, "alias.js"));
  await symlink(join(root, "shared.css"), join(root, "style.js"));
  const { id } = await service.create(input, origin);
  await assert.rejects(service.resource(id, "escape/secret.css", origin));
  await assert.rejects(service.resource(id, "alias.js", origin));
  await assert.rejects(service.resource(id, "style.js", origin));
  await assert.rejects(
    service.create({ ...input, path: "escape/secret.html" }, origin),
  );
  await assert.rejects(
    service.create({ ...input, path: "/tmp/test.html" }, origin),
  );
  await assert.rejects(
    service.create({ ...input, path: "shared.css" }, origin),
  );
  for (const remote of [
    origin,
    "https://cdn.test/path",
    "https://user@cdn.test",
    "data:text/html,x",
  ]) {
    await assert.rejects(
      service.create(
        { ...input, approvals: [{ origin: remote, category: "script" }] },
        origin,
      ),
    );
  }
  await assert.rejects(
    service.create(
      {
        ...input,
        approvals: [{ origin: "https://cdn.test", category: "connect" }],
      },
      origin,
    ),
  );
  await assert.rejects(
    service.create({ ...input, text: "😀".repeat(300_000) }, origin),
  );
});

test("lazily expires, revokes, bounds sessions, and invalidates re-rooted projects", async (t) => {
  const { service, input, setTime, setDirectory, root } = await fixture(t);
  const { id } = await service.create(input, origin);
  setTime(14 * 60 * 1_000);
  await service.resource(id, undefined, origin);
  setTime(28 * 60 * 1_000);
  await service.resource(id, undefined, origin);
  setTime(43 * 60 * 1_000);
  await assert.rejects(service.resource(id, undefined, origin));
  const revoked = await service.create(input, origin);
  service.revoke(revoked.id);
  await assert.rejects(service.resource(revoked.id, undefined, origin));
  for (let i = 0; i < 64; i++) await service.create(input, origin);
  await assert.rejects(service.create(input, origin));
  setTime(60 * 60 * 1_000);
  const rerooted = await service.create(input, origin);
  setDirectory(join(root, "pages"));
  await assert.rejects(service.resource(rerooted.id, undefined, origin));
});

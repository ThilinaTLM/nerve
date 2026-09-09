import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const harnessNodeUrl = pathToFileURL(
  join(repoRoot, "packages/harness/dist/node.js"),
).href;
const normalizationUrl = pathToFileURL(
  join(repoRoot, "packages/harness/dist/models/image/normalization.js"),
).href;
const desktopRequire = createRequire(
  join(repoRoot, "packages/desktop-shell/package.json"),
);
const electronPath = desktopRequire("electron");
const root = await mkdtemp(join(tmpdir(), "nerve-electron-image-smoke-"));

try {
  const oversizedPath = join(root, "oversized.png");
  const smallPath = join(root, "small.png");
  await Promise.all([
    sharp({
      create: {
        width: 1_400,
        height: 2_600,
        channels: 3,
        background: { r: 32, g: 96, b: 160 },
      },
    })
      .png()
      .toFile(oversizedPath),
    sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 16, g: 32, b: 48 },
      },
    })
      .png()
      .toFile(smallPath),
  ]);

  const driverPath = join(root, "driver.mjs");
  await writeFile(
    driverPath,
    `import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resizeImage } from ${JSON.stringify(harnessNodeUrl)};
import { normalizeImagesForModel } from ${JSON.stringify(normalizationUrl)};

const oversized = await readFile(process.argv[2]);
const small = await readFile(process.argv[3]);
const direct = await resizeImage(oversized, "image/png", 2_000);
assert.equal(direct.changed, true);
assert.deepEqual({ width: direct.width, height: direct.height }, { width: 1_077, height: 2_000 });

const olderImage = { type: "image", data: oversized.toString("base64"), mimeType: "image/png" };
const smallImage = { type: "image", data: small.toString("base64"), mimeType: "image/png" };
const olderMessage = {
  role: "toolResult",
  toolCallId: "older-read",
  toolName: "read",
  content: [{ type: "text", text: "Read image file" }, olderImage],
  isError: false,
  timestamp: 1,
};
const messages = [
  olderMessage,
  { role: "user", content: Array.from({ length: 20 }, () => smallImage), timestamp: 2 },
];
const normalized = await normalizeImagesForModel(messages, { api: "anthropic-messages" });
const normalizedImage = normalized[0].content[1];
assert.equal(normalizedImage.type, "image");
assert.notEqual(normalizedImage.data, olderImage.data);
assert.equal(olderMessage.content[1].data, olderImage.data);
const normalizedBytes = Buffer.from(normalizedImage.data, "base64");
const checked = await resizeImage(normalizedBytes, normalizedImage.mimeType, 2_000);
assert.deepEqual({ width: checked.width, height: checked.height }, { width: 1_077, height: 2_000 });

const malformed = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(malformed);
malformed.writeUInt32BE(190, 16);
malformed.writeUInt32BE(8_101, 20);
await assert.rejects(
  normalizeImagesForModel(
    [{ role: "user", content: [{ type: "image", data: malformed.toString("base64"), mimeType: "image/png" }], timestamp: 3 }],
    { api: "anthropic-messages" },
  ),
  /Could not prepare image.*8101.*8000px/,
);
console.log(JSON.stringify({ ok: true, width: direct.width, height: direct.height }));
`,
  );

  for (const directory of [
    "nerve-home",
    "home",
    "xdg-config",
    "xdg-cache",
    "tmp",
  ]) {
    await mkdir(join(root, directory));
  }

  const result = await runElectron(driverPath, oversizedPath, smallPath);
  assert.equal(result.ok, true);
  assert.deepEqual(
    { width: result.width, height: result.height },
    { width: 1_077, height: 2_000 },
  );
  console.log("Electron image resize smoke passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function runElectron(driverPath, oversizedPath, smallPath) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    // GitHub's Linux runners cannot use Electron's unprivileged or SUID sandbox.
    // This is inherited by the native-image subprocess launched by the driver.
    ELECTRON_DISABLE_SANDBOX: "1",
    NERVE_HOME: join(root, "nerve-home"),
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    TMPDIR: join(root, "tmp"),
  };
  const child = spawn(electronPath, [driverPath, oversizedPath, smallPath], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  const outputLimit = 64 * 1_024;
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk, outputLimit);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk, outputLimit);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(
      code,
      0,
      `Electron image smoke failed${signal ? ` with ${signal}` : ""}: ${stderr.trim()}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  const lines = stdout.trim().split("\n");
  const output = JSON.parse(lines.at(-1) ?? "");
  return output;
}

function appendBounded(current, chunk, limit) {
  if (current.length >= limit) return current;
  return current + chunk.toString("utf8").slice(0, limit - current.length);
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import {
  readBuiltinExtensionAsset,
  readBuiltinExtensionBundle,
} from "@nervekit/extensions/assets";
import {
  builtinExtensions,
  sandboxedBuiltinExtensions,
} from "@nervekit/extensions";
import {
  routedExtensionCode,
  sandboxExtensionCode,
} from "@nervekit/tools/extension-host";
import {
  classifyQuickScriptScript,
  createQuickScriptRegistry,
  executeQuickScript,
} from "@nervekit/tools/quick-script";

/*
 * `diagram.render` end to end with the extension's code in the sandbox: parse,
 * authorize and run happen in the persistent runtime; the host serves `ctx.http`
 * (allowlist), the artifact write and the nested authorization.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const skip = !sandbox.isPersistentAvailable();
let server: Server;
let base = "";
let root = "";
let bundlesRead = 0;
const bodies: string[] = [];

const registry = createQuickScriptRegistry(builtinExtensions, {
  readExtensionAsset: readBuiltinExtensionAsset,
  extensionCodeAdapter: routedExtensionCode({
    sandboxed: (definition) => sandboxedBuiltinExtensions.has(definition.id),
    sandbox: sandboxExtensionCode({
      bundle: (definition) => {
        bundlesRead++;
        return readBuiltinExtensionBundle(definition.id);
      },
    }),
  }),
});

before(async () => {
  root = await mkdtemp(join(tmpdir(), "diagram-sandbox-"));
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/kroki/") {
        response.setHeader("content-type", "image/png");
        return void response.end(PNG);
      }
      response.statusCode = 400;
      response.end("Error 400: Unsupported output format: png");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});

async function run(code: string, settings: Record<string, unknown>) {
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  const conversationDir = join(root, "conversation");
  const authorized: unknown[] = [];
  const result = await executeQuickScript(
    { code },
    {
      cwd,
      conversationDir,
      registry,
      webFetchPolicy: { allowPrivateNetwork: true },
      authorizeNested: async (request) => void authorized.push(request),
      extensionPorts: {
        settings: () => settings,
        accounts: {
          get: async () => undefined,
          state: async () => "needs_sign_in",
          apply: async () => ({ ok: false, state: "needs_sign_in" }),
        },
      },
    },
  );
  return { result, authorized, conversationDir };
}

void test(
  "diagram.render runs in the sandbox and saves the PNG as before",
  { skip },
  async () => {
    const before = bundlesRead;
    const { result, authorized, conversationDir } = await run(
      `console.log(await diagram.render({ type: "mermaid", source: "pie\\n\\"a\\": 1" }));`,
      { server: `${base}/kroki/` },
    );
    assert.equal(bundlesRead, before + 1);
    assert.equal(result.content?.split("\n")[0], "artifact:diagram-1.png");
    assert.deepEqual(await readdir(join(conversationDir, "quick-script")), [
      "diagram-1.png",
    ]);
    assert.deepEqual(authorized[0], {
      operation: "diagram.render",
      targets: [],
      risk: "external_read",
    });
    const sent = JSON.parse(bodies.at(-1)!) as { diagram_source: string };
    assert.match(sent.diagram_source, /^%%\{init: /);
  },
);

void test(
  "diagram.render errors reach the script with their code and fix",
  { skip },
  async () => {
    const missing = await run(
      `try { await diagram.render({ type: "mermaid", source: "graph TD; A-->B" }); } catch (e) { console.log(e.code + "|" + e.message); }`,
      { server: "" },
    );
    assert.equal(
      missing.result.content?.split("\n")[0],
      "BAD_REQUEST|No Kroki server is configured. Ask the user to set one in Settings → Extensions → Diagrams.",
    );
    const invalid = await run(
      `try { await diagram.render({ type: "Not Valid", source: "x" }); } catch (e) { console.log(e.code + "|" + e.message); }`,
      { server: `${base}/kroki/` },
    );
    assert.match(
      invalid.result.content ?? "",
      /^BAD_REQUEST\|type must be a Kroki engine name/,
    );
    const rejected = await run(
      `try { await diagram.render({ type: "mermaid", source: "x" }); } catch (e) { console.log(e.code + "|" + e.message); }`,
      { server: `${base}/refuse/` },
    );
    assert.match(
      rejected.result.content ?? "",
      /^BAD_REQUEST\|Kroki returned HTTP 400: Error 400: Unsupported output format: png/,
    );
  },
);

void test(
  "the script scan classifies diagram.render outside a run, without a run context",
  { skip },
  async () => {
    const scan = await classifyQuickScriptScript(
      `await diagram.render({ type: "mermaid", source: "graph TD; A-->B" });`,
      registry,
    );
    assert.equal(scan.risk, "external_read");
    assert.equal(scan.admissible, true);
    assert.deepEqual(
      scan.calls.map((call) => call.operation),
      ["diagram.render"],
    );
  },
);

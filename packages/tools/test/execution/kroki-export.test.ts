import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { krokiExportResultDetailsSchema } from "@nervekit/contracts/tools";
import { executeKrokiExport } from "../../src/execution/kroki/kroki-export.js";
import type { KrokiExecutionContext } from "../../src/execution/execution-context.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const args = {
  diagram_type: "graphviz",
  source: "digraph G { Hello -> World }",
};
async function setup(
  t: TestContext,
): Promise<KrokiExecutionContext & { artifactDir: string }> {
  const artifactDir = await mkdtemp(join(tmpdir(), "nerve-kroki-"));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  return {
    cwd: artifactDir,
    artifactDir,
    kroki: { url: "http://127.0.0.1:9080/prefix" },
  };
}
function response(
  body: string | Buffer = svg,
  type = "image/svg+xml",
): Response {
  return new Response(body, { headers: { "content-type": type } });
}

describe("Kroki export", () => {
  it("POSTs preserved source to the configured prefix and declares a managed SVG", async (t) => {
    const context = await setup(t);
    const source = `\n ${args.source}\n`;
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        assert.equal(url, "http://127.0.0.1:9080/prefix/");
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "manual");
        assert.deepEqual(init.headers, {
          "Content-Type": "application/json",
          Accept: "image/svg+xml",
        });
        assert.deepEqual(JSON.parse(String(init.body)), {
          diagram_source: source,
          diagram_type: "graphviz",
          output_format: "svg",
        });
        assert.ok(init.signal instanceof AbortSignal);
        return response(svg, "image/svg+xml; charset=UTF-8");
      },
    );
    const result = await executeKrokiExport({ ...args, source }, context);
    const details = krokiExportResultDetailsSchema.parse(result.details);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(details.path, join(context.artifactDir, "diagram.svg"));
    assert.equal(await readFile(details.path, "utf8"), svg);
    assert.equal(details.bytes, Buffer.byteLength(svg));
    assert.deepEqual(details.outputLimits?.artifacts?.[0], {
      role: "primary_result",
      path: details.path,
      format: { kind: "image", mediaType: "image/svg+xml" },
      bytes: details.bytes,
      label: "Exported diagram",
      recommendedTools: ["read"],
    });
    assert.ok(!JSON.stringify(result).includes(source));
  });

  it("exports PNG with raster inspection recommendations", async (t) => {
    const context = await setup(t);
    t.mock.method(globalThis, "fetch", async () => response(png, "image/png"));
    const details = krokiExportResultDetailsSchema.parse(
      (await executeKrokiExport({ ...args, output_format: "png" }, context))
        .details,
    );
    assert.deepEqual(await readFile(details.path), png);
    assert.deepEqual(details.outputLimits?.artifacts?.[0]?.recommendedTools, [
      "read",
      "explain_image",
    ]);
  });

  it("validates configuration, paths, source byte limits and format before requesting", async (t) => {
    const context = await setup(t);
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      response(),
    );
    await assert.rejects(
      executeKrokiExport(args, { ...context, kroki: undefined }),
      /not configured/,
    );
    await assert.rejects(
      executeKrokiExport(args, { ...context, artifactDir: undefined }),
      /artifact output directory/,
    );
    await assert.rejects(
      executeKrokiExport(args, {
        ...context,
        kroki: { url: "https://user:pass@example.org" },
      }),
    );
    for (const override of [
      { source: " " },
      { source: "é".repeat(65_537) },
      { output_format: "pdf" },
      { diagram_type: "../mermaid" },
    ]) {
      await assert.rejects(
        executeKrokiExport({ ...args, ...override }, context),
      );
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("rejects redirects rather than forwarding diagram source", async (t) => {
    const context = await setup(t);
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://other.example" },
        }),
    );
    await assert.rejects(
      executeKrokiExport(args, context),
      /redirects are not allowed/,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(await readdir(context.artifactDir), []);
  });

  it("bounds and cleans HTTP diagnostics without retrying", async (t) => {
    const context = await setup(t);
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          Buffer.from(
            `<html>Invalid diagram ${args.source}</html>${"x".repeat(10_000)}`,
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(body, { status: 400 }),
    );
    await assert.rejects(
      executeKrokiExport(args, context),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 400: Invalid diagram/);
        assert.ok(error.message.length < 600);
        assert.ok(
          !error.message.includes("<html>") &&
            !error.message.includes(args.source),
        );
        return true;
      },
    );
    assert.ok(cancelled);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(await readdir(context.artifactDir), []);
  });

  it("rejects empty, mismatched and invalid image data", async (t) => {
    const context = await setup(t);
    const invalid = [
      response(""),
      response(svg, "text/html"),
      response("not svg"),
      response(png),
      response(svg, "image/png"),
    ];
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () => invalid.shift()!,
    );
    for (let index = 0; index < 5; index++) {
      await assert.rejects(
        executeKrokiExport(
          { ...args, ...(index === 4 ? { output_format: "png" } : {}) },
          context,
        ),
      );
    }
    assert.equal(fetchMock.mock.callCount(), 5);
    assert.deepEqual(await readdir(context.artifactDir), []);
  });

  it("bounds advertised and streamed responses, cancelling their bodies", async (t) => {
    const context = await setup(t);
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(oversized, {
          headers: {
            "content-type": "image/svg+xml",
            "content-length": String(oversized.length),
          },
        }),
    );
    await assert.rejects(executeKrokiExport(args, context), /exceeds/);
    let cancelled = false;
    fetchMock.mock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversized);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "image/svg+xml" } },
        ),
    );
    await assert.rejects(executeKrokiExport(args, context), /exceeds/);
    assert.ok(cancelled);
    assert.deepEqual(await readdir(context.artifactDir), []);
  });

  it("propagates pre-abort and uses the fixed timeout", async (t) => {
    const context = await setup(t);
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      response(),
    );
    await assert.rejects(
      executeKrokiExport(args, {
        ...context,
        signal: AbortSignal.abort(new Error("cancelled")),
      }),
      /cancelled/,
    );
    t.mock.method(AbortSignal, "timeout", (ms: number) => {
      assert.equal(ms, 60_000);
      return AbortSignal.abort(new DOMException("Timed out", "TimeoutError"));
    });
    await assert.rejects(executeKrokiExport(args, context), {
      name: "TimeoutError",
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("cancels a stalled response stream when execution is aborted", async (t) => {
    const context = await setup(t);
    const controller = new AbortController();
    let cancelled = false;
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(Buffer.from(svg));
            },
            pull() {
              controller.abort(new Error("cancelled mid-stream"));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "image/svg+xml" } },
        ),
    );
    await assert.rejects(
      executeKrokiExport(args, { ...context, signal: controller.signal }),
      /cancelled mid-stream/,
    );
    assert.ok(cancelled);
    assert.deepEqual(await readdir(context.artifactDir), []);
  });
});

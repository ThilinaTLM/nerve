import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchKrokiDiagram } from "./kroki-export.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const options = {
  url: "http://127.0.0.1:9080/prefix/",
  diagramType: "graphviz",
  source: "digraph G { Hello -> World }",
  outputFormat: "svg" as const,
  signal: new AbortController().signal,
};
const response = (body: string | Buffer, type: string, status = 200) =>
  new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status,
    headers: { "content-type": type },
  });

describe("fetchKrokiDiagram", () => {
  it("POSTs the source untouched and returns validated bytes", async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        assert.equal(url, options.url);
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "manual");
        assert.deepEqual(JSON.parse(String(init.body)), {
          diagram_source: options.source,
          diagram_type: "graphviz",
          output_format: "svg",
        });
        return response(svg, "image/svg+xml; charset=UTF-8");
      },
    );
    assert.equal((await fetchKrokiDiagram(options)).toString("utf8"), svg);
  });

  it("returns PNG bytes", async (t) => {
    t.mock.method(globalThis, "fetch", async () => response(png, "image/png"));
    assert.deepEqual(
      await fetchKrokiDiagram({ ...options, outputFormat: "png" }),
      png,
    );
  });

  it("rejects redirects, wrong media types and invalid data", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      response("", "text/plain", 302),
    );
    await assert.rejects(
      fetchKrokiDiagram(options),
      /redirects are not allowed/,
    );
    fetchMock.mock.mockImplementation(async () => response(svg, "text/html"));
    await assert.rejects(
      fetchKrokiDiagram(options),
      /did not return image\/svg/,
    );
    fetchMock.mock.mockImplementation(async () =>
      response("<html/>", "image/svg+xml"),
    );
    await assert.rejects(fetchKrokiDiagram(options), /invalid SVG data/);
  });

  it("reports the server diagnostic without echoing the source", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      response(`Error 400: bad ${options.source}`, "text/plain", 400),
    );
    await assert.rejects(fetchKrokiDiagram(options), (error: Error) => {
      assert.match(error.message, /HTTP 400/);
      assert.ok(!error.message.includes(options.source));
      return true;
    });
  });
});

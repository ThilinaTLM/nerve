import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeContext } from "@nervekit/extension-api/testing";
import type { HttpResponse } from "@nervekit/extension-api";
import { fetchKrokiDiagram } from "./kroki-export.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const options = {
  url: "http://127.0.0.1:9080/prefix/",
  diagramType: "graphviz",
  source: "digraph G { Hello -> World }",
};
const reply = (
  body: Uint8Array | string,
  type: string,
  status = 200,
): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { "content-type": type },
  url: options.url,
  body: typeof body === "string" ? new TextEncoder().encode(body) : body,
});

describe("fetchKrokiDiagram", () => {
  it("POSTs the source untouched and returns validated PNG bytes", async () => {
    const { ctx, record } = createFakeContext({
      http: () => reply(png, "image/png"),
    });
    assert.deepEqual(await fetchKrokiDiagram(ctx, options), png);
    const [request] = record.requests;
    assert.equal(request.url, options.url);
    assert.equal(request.method, "POST");
    assert.deepEqual((request.body as { json: unknown }).json, {
      diagram_source: options.source,
      diagram_type: "graphviz",
      output_format: "png",
    });
  });

  it("rejects wrong media types and invalid data", async () => {
    let next = reply(png, "text/html");
    const { ctx } = createFakeContext({ http: () => next });
    await assert.rejects(
      fetchKrokiDiagram(ctx, options),
      /did not return image\/png/,
    );
    next = reply("<html/>", "image/png");
    await assert.rejects(fetchKrokiDiagram(ctx, options), /invalid PNG data/);
  });

  it("reports the server diagnostic without echoing the source", async () => {
    const { ctx } = createFakeContext({
      http: () => reply(`Error 400: bad ${options.source}`, "text/plain", 400),
    });
    await assert.rejects(fetchKrokiDiagram(ctx, options), (error: Error) => {
      assert.match(error.message, /HTTP 400/);
      assert.ok(!error.message.includes(options.source));
      return true;
    });
  });
});

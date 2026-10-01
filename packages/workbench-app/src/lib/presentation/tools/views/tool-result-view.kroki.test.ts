import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import { toolCall, transcriptToolCall } from "./tool-result-view.fixtures";
import { presentToolArguments } from "../lifecycle/registry";

const args = { diagram_type: "mermaid", source: "graph TD; A-->B" };
const details = {
  diagramType: "mermaid",
  outputFormat: "svg",
  path: "/tmp/diagram.svg",
  filename: "diagram.svg",
  mediaType: "image/svg+xml",
  bytes: 2048,
};

describe("Kroki tool presentation", () => {
  it("projects an exported path and metadata without embedding source or image bytes", () => {
    const record = toolCall("kroki_export", args, {
      content: "Exported mermaid diagram as SVG.",
      details,
    });
    const view = parseToolView(record);
    assert.deepEqual(view, {
      kind: "kroki_export",
      path: "/tmp/diagram.svg",
      bytes: 2048,
    });
    const presentation = toolPresentation(view, record);
    assert.equal(presentation.primaryArg?.text, "mermaid → SVG");
    assert.deepEqual(presentation.meta, [{ text: "2.0 KB", tone: "success" }]);
  });
  it("renders the same output from durable transcript previews", () => {
    const record = transcriptToolCall(
      "kroki_export",
      { diagram_type: "mermaid" },
      { content: "Exported", details },
    );
    const view = parseToolView(record);
    assert.equal(view.kind, "kroki_export");
    if (view.kind === "kroki_export") assert.equal(view.path, details.path);
    assert.equal(
      toolPresentation(view, record).primaryArg?.text,
      "mermaid → SVG",
    );
  });
  it("handles missing and malformed results without showing fake artifact links", () => {
    for (const result of [
      undefined,
      { details: {} },
      { details: { ...details, mediaType: "application/pdf" } },
      { details: { ...details, path: "" } },
    ]) {
      const record = toolCall(
        "kroki_export",
        { diagram_type: "graphviz", output_format: "png" },
        result,
      );
      const view = parseToolView(record);
      assert.equal(view.kind, "kroki_export");
      if (view.kind !== "kroki_export") continue;
      assert.equal(view.path, undefined);
      assert.equal(
        toolPresentation(view, record).primaryArg?.text,
        "graphviz → PNG",
      );
      assert.deepEqual(toolPresentation(view, record).meta, []);
    }
  });
  it("bounds approval source and warns that it leaves the machine", () => {
    const record = toolCall(
      "kroki_export",
      { ...args, source: "x".repeat(32_000) },
      undefined,
    );
    const presentation = presentToolArguments(
      "kroki_export",
      record,
      "approval",
    );
    assert.match(JSON.stringify(presentation), /Sends diagram source/);
    assert.ok(JSON.stringify(presentation).length < 8_000);
  });
});

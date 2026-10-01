import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { executeTool } from "@nervekit/tools/execution";
import {
  agentResultPolicyForTool,
  projectAgentResult,
} from "@nervekit/tools/result-projection";
import { krokiExportResultDetailsSchema } from "@nervekit/contracts/tools";
import { ToolResultArtifactValidator } from "../../../src/domains/tools/artifacts/tool-result-artifact-validator.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";
import { fileContent } from "../../../src/domains/filesystem/filesystem.service.js";

it("validates and projects Kroki artifacts and opens SVG/PNG through the existing file service", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-kroki-artifacts-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const payloads = new ToolResultPayloadStore(home);
  await payloads.initialize();
  const validator = new ToolResultArtifactValidator(home, payloads);
  for (const format of ["svg", "png"] as const) {
    const mediaType = format === "svg" ? "image/svg+xml" : "image/png";
    const data =
      format === "svg"
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(data, { headers: { "content-type": mediaType } }),
    );
    const identity = {
      conversationId: "conv_kroki",
      toolCallId: `tool_${format}`,
    };
    const args = {
      diagram_type: "mermaid",
      source: "graph TD; A-->B",
      output_format: format,
    };
    const result = await executeTool("kroki_export", args, {
      cwd: home,
      artifactDir: payloads.filesPath(
        identity.conversationId,
        identity.toolCallId,
      ),
      kroki: { url: "http://127.0.0.1:9080/" },
    });
    const details = krokiExportResultDetailsSchema.parse(result.details);
    const validatedArtifacts = await validator.validateClaims(
      identity,
      details.outputLimits?.artifacts ?? [],
    );
    assert.equal(validatedArtifacts[0]?.availability, "available");
    assert.deepEqual(validatedArtifacts[0]?.access, {
      kind: "agent_file",
      path: details.path,
    });
    if (format === "svg")
      assert.deepEqual(validatedArtifacts[0]?.recommendedTools, ["read"]);
    const projection = projectAgentResult(
      {
        toolName: "kroki_export",
        args,
        result,
        status: "completed",
        phase: "completed",
        validatedArtifacts,
      },
      agentResultPolicyForTool("kroki_export"),
    );
    assert.ok(JSON.stringify(projection.blocks).includes(details.path));
    assert.ok(projection.snapshot.artifactRoles.includes("primary_result"));
    const file = await fileContent(
      { projectId: "proj_kroki", path: details.path },
      () => home,
    );
    assert.equal(file.type, "image");
    assert.equal(file.mimeType, mediaType);
  }
});

it("reports output_path exports to the agent without an artifact claim", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-kroki-output-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        headers: { "content-type": "image/svg+xml" },
      }),
  );
  const args = {
    diagram_type: "mermaid",
    source: "graph TD; A-->B",
    output_path: "docs/flow.svg",
  };
  const result = await executeTool("kroki_export", args, {
    cwd: home,
    kroki: { url: "http://127.0.0.1:9080/" },
  });
  const path = join(home, "docs", "flow.svg");
  const projection = projectAgentResult(
    {
      toolName: "kroki_export",
      args,
      result,
      status: "completed",
      phase: "completed",
      validatedArtifacts: [],
    },
    agentResultPolicyForTool("kroki_export"),
  );
  assert.ok(JSON.stringify(projection.blocks).includes(path));
});

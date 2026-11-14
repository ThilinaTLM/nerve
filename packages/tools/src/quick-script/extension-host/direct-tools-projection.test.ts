import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defineExtension, defineTool } from "@nervekit/extension-api";
import { measureBlocks } from "../../result-projection/measure.js";
import { projectAgentResult } from "../../result-projection/projector.js";
import { policy } from "../../result-projection/policies/define-policy.js";
import { searchResultPolicy } from "../../result-projection/policies/search.js";
import { textCandidate } from "../../result-projection/candidates/text.js";
import type { CandidateContext } from "../../result-projection/types.js";
import { createQuickScriptRegistry } from "../registry.js";
import { createExtensionToolDefinitions } from "./direct-tools.js";

type Hit = { title: string; url: string; content: string };
const hits: Hit[] = Array.from({ length: 5 }, (_, index) => ({
  title: `Result ${index + 1}`,
  url: `https://site${index + 1}.test/page`,
  content: `Content ${index + 1}.\n${"The page explains the topic in depth.\n".repeat(40)}`,
}));
const answer = "A short synthesized answer.";

const snippet = (text: string) =>
  text.length <= 300 ? text : `${text.slice(0, 299)}…`;

const search = defineExtension({
  apiVersion: 1,
  id: "finder",
  name: "Finder",
  description: "Test.",
  icon: "globe",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
  tools: [
    defineTool({
      name: "finder_search",
      description: "Search.",
      parameters: { type: "object", properties: {} },
      display: "links",
      risk: "network",
      parse: () => ({}),
      run: () => ({ answer, hits }),
      present: (output: { answer: string; hits: Hit[] }) => ({
        text: [
          `**Answer:** ${output.answer}`,
          "",
          ...output.hits.flatMap((hit) => [
            `### ${hit.title}`,
            hit.url,
            "",
            hit.content,
            "",
          ]),
        ].join("\n"),
        value: output.hits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: snippet(hit.content),
        })),
        details: { query: "topic", answer: output.answer },
      }),
    }),
  ],
});

const text = (blocks: { type: string; text?: string }[]) =>
  blocks.map((block) => block.text ?? "").join("");

void test("a links tool's agent projection keeps every result with a bounded share, like the old core web_search", async () => {
  const [definition] = createExtensionToolDefinitions(
    createQuickScriptRegistry([search]),
  );
  const conversationDir = await mkdtemp(join(tmpdir(), "projection-"));
  const result = await (
    definition as unknown as {
      executor: (
        args: unknown,
        context: unknown,
      ) => Promise<{ content: string; details: Record<string, unknown> }>;
    }
  ).executor(
    {},
    {
      cwd: conversationDir,
      conversationDir,
      extensionPorts: { settings: () => ({}), accounts: {} },
    },
  );
  const context = (value: unknown): CandidateContext => ({
    toolName: "finder_search",
    args: {},
    result: value,
    status: "completed",
    phase: "completed",
    validatedArtifacts: [],
  });

  const projected = projectAgentResult(context(result), definition.agentResult);
  const visible = text(projected.blocks);
  for (const hit of hits) {
    assert.ok(visible.includes(hit.title), hit.title);
    assert.ok(visible.includes(hit.url), hit.url);
  }
  assert.ok(visible.includes(answer));
  assert.ok(visible.includes("Query: topic"));
  assert.ok(!visible.includes(hits[0].content), "content is bounded");
  assert.equal(projected.snapshot.profile, "search_summaries");

  // The removed core tool: same policy over details `{ query, answer, results }` with 300-character snippets.
  const old = projectAgentResult(
    context({
      content: "",
      details: {
        query: "topic",
        answer,
        results: hits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          content: snippet(hit.content),
          score: 0.5,
        })),
      },
    }),
    searchResultPolicy,
  );
  assert.equal(
    measureBlocks(projected.blocks).bytes,
    measureBlocks(old.blocks).bytes,
    "same visible size as the old core tool",
  );

  // Before: the generic prose policy cut the text to a few lines.
  const before = projectAgentResult(
    context(result),
    policy("network_prose", "head", textCandidate),
  );
  const shown = (blocks: typeof before.blocks) =>
    hits.filter((hit) => text(blocks).includes(hit.title)).length;
  assert.equal(shown(projected.blocks), 5);
  assert.ok(shown(before.blocks) < 5, "the prose policy lost results");
});

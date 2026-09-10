import assert from "node:assert/strict";
import { test } from "node:test";
import { safeTerminalResource } from "../../src/result-projection/terminal-resource.js";
import { formatWebFetchCandidateText } from "../../src/result-projection/candidates/web.js";

function resource(result: unknown) {
  return safeTerminalResource({
    toolName: "web_fetch",
    args: {},
    result,
    status: "completed",
    validatedArtifacts: [],
  });
}

test("terminal labels and web metadata redact URL credentials and sensitive query parameters", () => {
  const url =
    "https://user:password@example.com/data?token=private&API_KEY=private&auth=private&signature=private&credential=private&password=private&secret=private&page=2";
  const safe = "https://example.com/data?page=2";
  assert.equal(resource({ details: { url } })?.label, safe);
  assert.equal(
    formatWebFetchCandidateText({ url }, "body"),
    `URL: ${safe}\nConverted: no\n\nbody`,
  );
});

test("terminal resource projection preserves file paths and omits absent resources", () => {
  assert.deepEqual(
    resource({ path: "/tmp/project/result.json", status: "completed" }),
    { label: "/tmp/project/result.json", state: "completed" },
  );
  assert.equal(resource({}), undefined);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { agentTextProblems } from "@nervekit/contracts/extensions";
import type { InstalledExtensionManifest } from "@nervekit/contracts/extensions";
import { extensionDefinitionData } from "@nervekit/extension-api/host";
import { builtinExtensions } from "@nervekit/extensions";

// The text limits of docs/agent-facing.md apply to every extension, built-ins included: the
// `quick_script` description is read on every turn whoever wrote the namespace.
const extensionsSource = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "extensions",
  "src",
);

for (const definition of builtinExtensions)
  void test(`built-in extension '${definition.id}' keeps its agent-facing text within the limits`, () => {
    let topicsRead = 0;
    const problems = agentTextProblems(
      extensionDefinitionData(
        definition,
      ) as unknown as InstalledExtensionManifest,
      (file) => {
        topicsRead += 1;
        return readFileSync(
          join(extensionsSource, definition.id, file),
          "utf8",
        );
      },
    );
    assert.deepEqual(problems, []);
    // An unreadable topic is skipped by the check, so make sure the topics were really read.
    const topics = definition.namespaces.reduce(
      (count, namespace) => count + (namespace.docs?.length ?? 0),
      0,
    );
    assert.equal(topicsRead, topics);
  });

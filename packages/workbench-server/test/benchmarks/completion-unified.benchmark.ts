// Requires the coordinated current native addon. Synthetic-only, platform-specific.
import { createSearchIndex } from "@nervekit/native";
import { measureUnifiedJudgments } from "./completion-unified-judgments.js";
console.log(
  JSON.stringify(await measureUnifiedJudgments(createSearchIndex), null, 2),
);

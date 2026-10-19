// Synthetic-only unified quality and policy evidence; no historical file-only baseline.
import { createSearchIndex } from "@nervekit/native";
import { measureUnifiedJudgments } from "./completion-unified-judgments.js";

console.log(
  JSON.stringify(await measureUnifiedJudgments(createSearchIndex), null, 2),
);

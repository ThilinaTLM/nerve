import { test } from "node:test";
import {
  fixture,
  registry,
} from "../../steps/0001-conversation-core/step-fixture.js";
import { corruptionSuite } from "./corruption-suite.js";

const knownGaps = {
  "record:domain_documents:prompt_suggestion_enablement":
    "Suggestion configuration decoding is currently home-wide (W1).",
  "record:domain_documents:prompt_suggestion_trust":
    "Suggestion trust decoding is currently home-wide (W1).",
  "record:domain_documents:task_definitions":
    "Project task configuration decoding is currently home-wide (W1).",
  "record:domain_documents:agent":
    "Ancillary agent decoding is currently home-wide (W1).",
  "record:domain_documents:project":
    "Project decoding is currently home-wide (W1).",
  "record:domain_documents:task":
    "Ancillary task decoding is currently home-wide (W1).",
};
void test("0001 shared corruption and crash recovery", async (t) => {
  await corruptionSuite(t, { registry, makeFixture: fixture, knownGaps });
});

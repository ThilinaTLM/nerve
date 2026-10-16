import { test } from "node:test";
import {
  fixture,
  registry,
} from "../../steps/0001-conversation-core/step-fixture.js";
import { corruptionSuite } from "./corruption-suite.js";

const knownGaps = {};
void test("0001 shared corruption and crash recovery", async (t) => {
  await corruptionSuite(t, { registry, makeFixture: fixture, knownGaps });
});

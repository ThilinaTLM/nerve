import { test } from "node:test";
import assert from "node:assert/strict";
import { modelInfoSchema } from "@nervekit/contracts/models";
import {
  isTitleModelCompatible,
  titleSettingsStatus,
} from "./title-settings.js";
const model = modelInfoSchema.parse({
  provider: "test",
  modelId: "text",
  name: "Text",
  label: "Text",
  maxOutputTokens: 100,
});
test("title models must support text generation", () => {
  assert.equal(isTitleModelCompatible(model), true);
  assert.equal(isTitleModelCompatible({ ...model, input: ["image"] }), false);
  assert.equal(isTitleModelCompatible({ ...model, maxOutputTokens: 0 }), false);
  assert.equal(isTitleModelCompatible({ ...model, faux: true }), false);
});
test("title status follows enabled, selection and availability", () => {
  assert.equal(titleSettingsStatus({ enabled: false, model: null }, []), "off");
  assert.equal(
    titleSettingsStatus({ enabled: true, model: null }, []),
    "no-model",
  );
  assert.equal(
    titleSettingsStatus({ enabled: true, model }, []),
    "unavailable",
  );
  assert.equal(titleSettingsStatus({ enabled: true, model }, [model]), "ready");
});

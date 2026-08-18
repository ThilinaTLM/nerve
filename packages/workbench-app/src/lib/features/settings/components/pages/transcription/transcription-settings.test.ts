import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSettingLines,
  parseLanguageLines,
  parseVocabularyLines,
  usesStructuredTranscriptionContext,
} from "./transcription-settings.js";

describe("transcription settings helpers", () => {
  it("describes structured context only for gpt-transcribe", () => {
    assert.equal(usesStructuredTranscriptionContext("gpt-transcribe"), true);
    assert.equal(
      usesStructuredTranscriptionContext("gpt-4o-transcribe"),
      false,
    );
    assert.equal(
      usesStructuredTranscriptionContext("gpt-4o-mini-transcribe"),
      false,
    );
  });

  it("normalizes and deduplicates language codes", () => {
    assert.deepEqual(parseLanguageLines(" EN \nzh-TW\nen\n"), {
      values: ["en", "zh-tw"],
    });
    assert.deepEqual(formatSettingLines(["en", "fr"]), "en\nfr");
    assert.match(parseLanguageLines("english").error ?? "", /ISO-style/);
  });

  it("preserves vocabulary spelling while deduplicating case-insensitively", () => {
    assert.deepEqual(parseVocabularyLines(" Nerve \nCodex CLI\nnerve\n"), {
      values: ["Nerve", "Codex CLI"],
    });
    assert.match(parseVocabularyLines("bad<term").error ?? "", /cannot/);
  });
});

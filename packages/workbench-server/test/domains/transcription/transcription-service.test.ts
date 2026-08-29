import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transcriptionRequestFields } from "../../../src/domains/transcription/transcription.service.js";

describe("transcription request fields", () => {
  it("keeps the existing default request free of optional context", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-4o-transcribe",
        languages: [],
        vocabulary: [],
      }),
      [["model", "gpt-4o-transcribe"]],
    );
  });

  it("uses structured languages and keywords for gpt-transcribe", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-transcribe",
        languages: ["en", "fr"],
        vocabulary: ["Nerve", "Codex CLI"],
      }),
      [
        ["model", "gpt-transcribe"],
        ["languages[]", "en"],
        ["languages[]", "fr"],
        ["keywords[]", "Nerve"],
        ["keywords[]", "Codex CLI"],
      ],
    );
  });

  it("converts 4o context into a prompt", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-4o-mini-transcribe",
        languages: ["en", "de"],
        vocabulary: ["Nerve"],
      }),
      [
        ["model", "gpt-4o-mini-transcribe"],
        [
          "prompt",
          "Expected languages: en, de. Use these exact spellings when spoken: Nerve.",
        ],
      ],
    );
  });
});

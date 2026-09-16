import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptItem } from "$lib/presentation/state";
import {
  beginOptimisticPrompt,
  rollbackOptimisticPrompt,
  type OptimisticPromptView,
} from "./optimistic-prompt-transaction";

function userMessage(text: string): TranscriptItem {
  return { role: "user", text, optimistic: true };
}

describe("optimistic prompt transaction", () => {
  it("restores the previous messages and submitted text after rejection", () => {
    const previous = [userMessage("previous")];
    const view: OptimisticPromptView = {
      composerText: "",
      optimisticMessages: previous,
    };
    const transaction = beginOptimisticPrompt(
      view,
      "new prompt",
      userMessage("new prompt"),
    );

    rollbackOptimisticPrompt(view, transaction);

    assert.equal(view.optimisticMessages, previous);
    assert.equal(view.composerText, "new prompt");
  });

  it("does not overwrite text entered while the request was pending", () => {
    const view: OptimisticPromptView = {
      composerText: "",
      optimisticMessages: [],
    };
    const transaction = beginOptimisticPrompt(
      view,
      "submitted",
      userMessage("submitted"),
    );
    view.composerText = "replacement draft";

    rollbackOptimisticPrompt(view, transaction);

    assert.deepEqual(view.optimisticMessages, []);
    assert.equal(view.composerText, "replacement draft");
  });
});

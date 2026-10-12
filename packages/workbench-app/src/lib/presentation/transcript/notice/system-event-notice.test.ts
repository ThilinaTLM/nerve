import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SystemEventNotice } from "../../state/transcript-types";
import {
  systemEventNoticeBody,
  systemEventNoticeModel,
} from "./system-event-notice";

function notice(overrides: Partial<SystemEventNotice> = {}): SystemEventNotice {
  return {
    entryId: "event-1",
    kind: "subagent_run_event",
    text: 'Sub-agent "research" (explore) completed.\nFindings',
    createdAt: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

describe("subagent transcript notices", () => {
  for (const variant of [
    { kind: "subagent_run_event" as const },
    { kind: "message" as const, details: { type: "subagent_event" } },
  ]) {
    it(`separates header, footer metadata and response for ${variant.kind}`, () => {
      const event = notice({
        ...variant,
        summary: 'Sub-agent "research" (explore) completed.',
        text: 'Sub-agent "research" (explore) completed.\nFindings\n[truncated; full response: /reports/research.md]',
      });
      let opened: string | undefined;
      const model = systemEventNoticeModel(event, {
        onOpenFile: (path) => (opened = path),
      });
      assert.equal(model.arg, "research");
      assert.equal(model.badge, "subagent_completed");
      assert.deepEqual(model.chips, [{ text: "explore" }]);
      assert.equal(systemEventNoticeBody(event), "Findings");
      model.action?.onClick();
      assert.equal(opened, "/reports/research.md");
    });
  }

  it("keeps failures in the error surface, not in the response", () => {
    const event = notice({
      text: 'Sub-agent "research" (explore) failed: connection lost\nPartial findings',
    });
    const model = systemEventNoticeModel(event);
    assert.equal(model.tone, "destructive");
    assert.equal(model.error, "connection lost");
    assert.equal(systemEventNoticeBody(event), "Partial findings");
  });

  it("keeps waiting command details and the provisional response", () => {
    const event = notice({
      kind: "message",
      details: { type: "subagent_event" },
      text: 'Sub-agent "research" (explore) is waiting on 1 background command and accepts follow-ups:\n"pnpm test" running 3m\nPartial findings',
    });
    assert.equal(systemEventNoticeModel(event).badge, "subagent_waiting");
    assert.equal(
      systemEventNoticeBody(event),
      '"pnpm test" running 3m\nPartial findings',
    );
  });

  it("preserves unrecognized text instead of dropping the update", () => {
    const event = notice({ text: "An unfamiliar update" });
    assert.equal(systemEventNoticeBody(event), "An unfamiliar update");
  });

  it("counts only response lines for the preview footer", () => {
    const event = notice({
      text: `Sub-agent "research" (explore) completed.\n${Array.from({ length: 8 }, (_, i) => `Finding ${i}`).join("\n")}`,
    });
    assert.deepEqual(systemEventNoticeModel(event).chips, [
      { text: "explore" },
      { text: "8 lines" },
    ]);
  });
});

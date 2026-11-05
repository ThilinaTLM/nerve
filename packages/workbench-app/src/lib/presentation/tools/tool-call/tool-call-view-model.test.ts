import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApprovalWithToolCall } from "../../state/tool-types";
import {
  deriveSheetVisibility,
  draftPrimaryArg,
  resolveConfigurationBlocked,
  resolveToolApproval,
  selectPrimaryArg,
} from "./tool-call-view-model";

const approval = { toolCallId: "t1" } as ApprovalWithToolCall;

describe("tool call view model", () => {
  it("binds approval only to the waiting call it belongs to", () => {
    assert.equal(
      resolveToolApproval({ id: "t1", status: "waiting" }, approval),
      approval,
    );
    assert.equal(
      resolveToolApproval({ id: "t1", status: "running" }, approval),
      undefined,
    );
    assert.equal(
      resolveToolApproval({ id: "t2", status: "waiting" }, approval),
      undefined,
    );
    assert.equal(resolveToolApproval(undefined, approval), undefined);
  });

  it("only exposes pending configuration-blocked requests", () => {
    const request = { diagnostics: [] };
    const make = (status: string) =>
      ({
        interaction: { kind: "configuration_blocked", status, request },
      }) as never;
    assert.equal(resolveConfigurationBlocked(make("pending")), request);
    assert.equal(resolveConfigurationBlocked(make("resolved")), undefined);
    assert.equal(resolveConfigurationBlocked(undefined), undefined);
  });

  it("falls back from durable to lifecycle to draft args unless plan-interactive", () => {
    const durable = { text: "d" };
    const lifecycle = { text: "l" };
    const draft = { text: "x" };
    assert.equal(
      selectPrimaryArg({ planInteractive: false, durable, lifecycle, draft }),
      durable,
    );
    assert.equal(
      selectPrimaryArg({
        planInteractive: false,
        durable: undefined,
        lifecycle,
        draft,
      }),
      lifecycle,
    );
    assert.equal(
      selectPrimaryArg({
        planInteractive: true,
        durable: undefined,
        lifecycle,
        draft,
      }),
      undefined,
    );
    assert.deepEqual(draftPrimaryArg({ path: "/a" }), { text: "/a" });
    assert.equal(draftPrimaryArg({}), undefined);
  });

  it("keeps plan review outside the sheet", () => {
    const base = {
      activitySections: {
        argumentVisible: true,
        resultMode: "output",
        errorVisible: false,
      } as const,
      hasAskUserDraftQuestions: false,
      hasAskUserView: false,
      hasErrorPreview: false,
    };
    assert.deepEqual(
      deriveSheetVisibility({ ...base, planInteractive: true }),
      {
        hilBodyVisible: true,
        sheetVisible: false,
      },
    );
    assert.deepEqual(
      deriveSheetVisibility({ ...base, planInteractive: false }),
      { hilBodyVisible: false, sheetVisible: true },
    );
    assert.equal(
      deriveSheetVisibility({
        ...base,
        planInteractive: false,
        activitySections: {
          argumentVisible: false,
          resultMode: "none",
          errorVisible: true,
        },
      }).sheetVisible,
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  atlassianDraftBody,
  draftField,
  streamedLineCount,
} from "./atlassian-draft";
import { presentToolArguments } from "./registry";

describe("atlassianDraftBody", () => {
  it("deduplicates labels and bounds field and text values", () => {
    const longField = "f".repeat(400);
    const longText = `${"head".repeat(100)}${"tail".repeat(1_600)}`;
    const body = atlassianDraftBody({
      fields: [
        draftField("Summary", longField),
        draftField("Summary", "duplicate"),
      ],
      text: { label: "Body", text: longText, language: "xml" },
    });

    assert.equal(body.kind, "atlassian-draft");
    if (body.kind !== "atlassian-draft") return;
    assert.equal(body.fields.length, 1);
    assert.equal(body.fields[0].value?.length, 300);
    assert.match(body.fields[0].value ?? "", /…$/);
    assert.equal(body.text?.text?.length, 6_000);
    assert.equal(body.text?.text, longText.slice(-6_000));
  });

  it("returns none only when fields and text are absent", () => {
    assert.deepEqual(atlassianDraftBody({ fields: [] }), { kind: "none" });
    const pending = atlassianDraftBody({
      fields: [],
      text: { label: "Body" },
    });
    assert.equal(pending.kind, "atlassian-draft");
  });

  it("counts normalized streaming lines", () => {
    assert.equal(streamedLineCount(undefined), undefined);
    assert.equal(streamedLineCount(""), undefined);
    assert.equal(streamedLineCount("one\r\ntwo\rthree"), 3);
  });
});

describe("Atlassian mutation lifecycle bodies", () => {
  it("fills Jira fields progressively from partial JSON", () => {
    const presentation = presentToolArguments(
      "jira_create_issue",
      { argsText: '{"project_key":"NER","summ' },
      "drafting",
    );

    assert.equal(presentation.body.kind, "atlassian-draft");
    if (presentation.body.kind !== "atlassian-draft") return;
    assert.equal(
      presentation.body.fields.find((field) => field.label === "Project")
        ?.value,
      "NER",
    );
    assert.equal(
      presentation.body.fields.find((field) => field.label === "Type")?.value,
      undefined,
    );
    assert.equal(
      presentation.body.fields.find((field) => field.label === "Summary")
        ?.value,
      undefined,
    );
    assert.equal(presentation.body.text?.label, "Description");
    assert.equal(presentation.body.text?.text, undefined);
  });

  it("streams partial Jira description text", () => {
    const presentation = presentToolArguments(
      "jira_create_issue",
      {
        argsText: '{"project_key":"NER","description":"Line one\\nLine tw',
      },
      "drafting",
    );

    assert.equal(presentation.body.kind, "atlassian-draft");
    if (presentation.body.kind !== "atlassian-draft") return;
    assert.equal(presentation.body.text?.text, "Line one\nLine tw");
  });

  it("renders inline Confluence page bodies as XML with a line chip", () => {
    const presentation = presentToolArguments(
      "confluence_create_page",
      {
        args: {
          space_key: "ENG",
          title: "Runbook",
          body: "<p>One</p>\n<p>Two</p>",
          body_representation: "storage",
        },
      },
      "drafting",
    );

    assert.equal(presentation.body.kind, "atlassian-draft");
    if (presentation.body.kind !== "atlassian-draft") return;
    assert.equal(presentation.body.fields.length, 0);
    assert.equal(presentation.body.text?.language, "xml");
    assert.match(presentation.body.text?.text ?? "", /<p>One<\/p>/);
    assert.ok(presentation.secondary.some((item) => item.text === "+2"));
  });

  it("keeps file-sourced Confluence page bodies header-only", () => {
    const presentation = presentToolArguments(
      "confluence_create_page",
      {
        args: {
          space_key: "ENG",
          title: "Runbook",
          page_file: "/tmp/page.json",
        },
      },
      "drafting",
    );
    assert.equal(presentation.body.kind, "none");
  });

  it("shows attachment fields for approval but not drafting", () => {
    const input = {
      args: {
        page_id: "123",
        file_path: "/tmp/diagram.png",
        comment: "Architecture",
      },
    };
    const approval = presentToolArguments(
      "confluence_upload_attachment",
      input,
      "approval",
    );
    assert.equal(approval.body.kind, "atlassian-draft");
    if (approval.body.kind === "atlassian-draft") {
      assert.ok(
        approval.body.fields.some(
          (field) => field.label === "Target page" && field.value === "123",
        ),
      );
    }
    assert.equal(
      presentToolArguments("confluence_upload_attachment", input, "drafting")
        .body.kind,
      "none",
    );
  });
});

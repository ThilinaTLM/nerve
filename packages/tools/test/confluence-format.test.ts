import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFLUENCE_DISPLAY_ITEM_LIMIT,
  displayLimitNotice,
  formatPageSummaryLine,
  summarizeConfluenceAttachment,
  summarizeConfluencePage,
  takeDisplayItems,
} from "../src/execution/confluence/format.js";
import { storageXmlToMarkdown } from "../src/execution/confluence/markdown.js";

describe("Confluence result formatting", () => {
  it("summarizes pages without carrying raw body payloads", () => {
    const summary = summarizeConfluencePage({
      id: "123",
      title: "How to deploy",
      spaceId: "987",
      space: { key: "DEV" },
      status: "current",
      version: { number: 7, message: "large" },
      body: { storage: { value: "<p>large body</p>" } },
      _links: { webui: "/spaces/DEV/pages/123/How+to+deploy" },
    });

    assert.deepEqual(summary, {
      id: "123",
      title: "How to deploy",
      spaceId: "987",
      spaceKey: "DEV",
      status: "current",
      versionNumber: 7,
      webui: "/spaces/DEV/pages/123/How+to+deploy",
    });
    assert.equal(
      formatPageSummaryLine(summary),
      "- 123 · How to deploy · space DEV · current · v7",
    );
  });

  it("caps displayed collections and emits a notice pointing to artifacts", () => {
    const items = Array.from(
      { length: CONFLUENCE_DISPLAY_ITEM_LIMIT + 3 },
      (_, index) => index,
    );
    const display = takeDisplayItems(items);

    assert.equal(display.items.length, CONFLUENCE_DISPLAY_ITEM_LIMIT);
    assert.equal(display.omitted, 3);
    assert.match(
      displayLimitNotice({
        noun: "page",
        total: display.total,
        displayed: display.displayed,
        artifactPath: "/tmp/confluence.json",
      }) ?? "",
      /Showing first 20 of 23 pages; full Confluence response is saved to \/tmp\/confluence\.json\./,
    );
  });

  it("summarizes attachments and converts common storage XML to markdown", () => {
    assert.deepEqual(
      summarizeConfluenceAttachment({
        id: "att-1",
        title: "image.png",
        mediaType: "image/png",
        fileSize: 42,
        version: { number: 2 },
        downloadLink: "/download/image.png",
      }),
      {
        id: "att-1",
        filename: "image.png",
        title: "image.png",
        mediaType: "image/png",
        fileSize: 42,
        versionNumber: 2,
        downloadLink: "/download/image.png",
      },
    );
    assert.match(
      storageXmlToMarkdown(
        '<p>Hello <strong>world</strong></p><ac:image><ri:attachment ri:filename="image.png" /></ac:image>',
      ),
      /Hello \*\*world\*\*/,
    );
  });
});

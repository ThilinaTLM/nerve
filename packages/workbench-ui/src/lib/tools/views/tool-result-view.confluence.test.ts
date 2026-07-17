import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { metaText, present, toolCall } from "./tool-result-view.fixtures";

describe("Confluence tool result view", () => {
  it("parses page search results and presentation metadata", () => {
    const result = {
      content: "Confluence page search returned 1 page.\n- 123 · Home",
      details: {
        action: "search_pages",
        cql: "type = page",
        pages: [{ id: "123", title: "Home", spaceKey: "DEV" }],
        pageCount: 1,
        displayedPageCount: 1,
      },
    };
    const view = parseToolView(
      toolCall("confluence_search_pages", { cql: "type = page" }, result),
    );
    assert.equal(view.kind, "confluence");
    if (view.kind !== "confluence") return;
    assert.equal(view.action, "search_pages");
    assert.equal(view.pages[0]?.title, "Home");
    assert.equal(view.cql, "type = page");

    const presentation = present(
      "confluence_search_pages",
      { cql: "type = page" },
      result,
    );
    assert.equal(presentation.primaryArg?.text, "type = page");
    assert.deepEqual(metaText(presentation.meta).slice(0, 1), ["1 page"]);
  });

  it("parses Confluence search cursors", () => {
    const view = parseToolView(
      toolCall(
        "confluence_search_spaces",
        { query: "docs" },
        {
          details: {
            action: "search_spaces",
            query: "docs",
            spaces: [{ id: "space-1", key: "DOC", name: "Docs" }],
            spaceCount: 1,
            nextCursor: "cursor-2",
          },
        },
      ),
    );
    assert.equal(view.kind, "confluence");
    if (view.kind !== "confluence") return;
    assert.equal(view.nextCursor, "cursor-2");
  });

  it("surfaces attachment counts in footer metadata", () => {
    const page = present(
      "confluence_get_page",
      { page_id: "123", include_attachments: true },
      {
        details: {
          action: "get_page",
          page: { id: "123", title: "Home" },
          attachmentCount: 3,
          includedCounts: { attachments: 3 },
        },
      },
    );
    assert.ok(metaText(page.meta).includes("3 attachments"));

    const download = present(
      "confluence_download_pages",
      { page_id: "123", download_attachments: true },
      {
        details: {
          action: "download_pages",
          pageCount: 1,
          includedCounts: { downloadedAttachments: 2 },
        },
      },
    );
    assert.ok(metaText(download.meta).includes("2 attachments"));
  });

  it("parses download paths and publish outcomes", () => {
    const downloadView = parseToolView(
      toolCall(
        "confluence_download_pages",
        { page_id: "123" },
        {
          content: "Downloaded 1 Confluence page to /tmp/bundle.",
          details: {
            action: "download_pages",
            downloadDir: "/tmp/bundle",
            manifestPath: "/tmp/bundle/manifest.json",
            pagesJsonlPath: "/tmp/bundle/pages.jsonl",
            pages: [{ id: "123", title: "Home", storagePath: "/tmp/body.xml" }],
            pageCount: 1,
          },
        },
      ),
    );
    assert.equal(downloadView.kind, "confluence");
    if (downloadView.kind !== "confluence") return;
    assert.equal(downloadView.downloadDir, "/tmp/bundle");
    assert.equal(downloadView.pagesJsonlPath, "/tmp/bundle/pages.jsonl");

    const publish = present(
      "confluence_publish_pages",
      { input_path: "/tmp/bundle/pages.jsonl" },
      {
        content: "Processed 1 Confluence page row.",
        details: {
          action: "publish_pages",
          inputPath: "/tmp/bundle/pages.jsonl",
          outcomes: [
            { index: 0, operation: "update", id: "123", status: "updated" },
          ],
          outcomeCount: 1,
        },
      },
    );
    assert.equal(publish.primaryArg?.text, "pages.jsonl");
    assert.ok(metaText(publish.meta).includes("1 outcome"));
  });
});

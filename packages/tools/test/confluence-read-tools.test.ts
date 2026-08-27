import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeConfluenceDownloadPage,
  executeConfluenceGetPage,
  executeConfluenceSearchSpaces,
} from "../src/execution/confluence/confluence.js";

const context = {
  cwd: process.cwd(),
  getApiKey: async () => "secret-token",
  getProviderConfig: async () => ({
    enabled: true,
    siteUrl: "https://example.atlassian.net",
    email: "developer@example.com",
  }),
};

describe("Confluence read request contracts", () => {
  it("sends only supported exact space filters and preserves the next cursor", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl: URL | undefined;
    globalThis.fetch = async (input) => {
      requestUrl = new URL(String(input));
      return Response.json({
        results: [{ id: "1", key: "SD", name: "Software" }],
        _links: { next: "/wiki/api/v2/spaces?cursor=next-2" },
      });
    };
    try {
      const result = await executeConfluenceSearchSpaces(
        {
          keys: ["SD", "ENG"],
          ids: ["1"],
          limit: 1,
          cursor: "next-1",
          query: "must-not-be-sent",
        },
        context,
      );
      assert.equal(requestUrl?.pathname, "/wiki/api/v2/spaces");
      assert.deepEqual(requestUrl?.searchParams.getAll("keys"), ["SD", "ENG"]);
      assert.deepEqual(requestUrl?.searchParams.getAll("ids"), ["1"]);
      assert.equal(requestUrl?.searchParams.get("cursor"), "next-1");
      assert.equal(requestUrl?.searchParams.has("query"), false);
      assert.equal(result.details?.nextCursor, "next-2");
      assert.equal(result.exitCode, undefined);
      assert.equal(
        (result.details as Record<string, unknown> | undefined)?.streams,
        undefined,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps compact download attachment modes", async () => {
    const originalFetch = globalThis.fetch;
    const paths: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/attachments")) {
        return Response.json({
          results: [
            {
              id: "att-1",
              title: "guide.txt",
              downloadLink: "/download/attachments/20/guide.txt",
            },
          ],
        });
      }
      if (url.pathname.includes("/download/attachments/")) {
        return new Response("guide");
      }
      return Response.json({
        id: "20",
        title: "Runbook",
        body: { storage: { value: "<p>Deploy</p>" } },
      });
    };
    try {
      await executeConfluenceDownloadPage(
        { page_id: "20", attachments: "none" },
        context,
      );
      assert.equal(
        paths.some((path) => path.endsWith("/attachments")),
        false,
      );

      paths.length = 0;
      await executeConfluenceDownloadPage(
        { page_id: "20", attachments: "metadata" },
        context,
      );
      assert.equal(
        paths.some((path) => path.endsWith("/attachments")),
        true,
      );
      assert.equal(
        paths.some((path) => path.includes("/download/attachments/")),
        false,
      );

      paths.length = 0;
      const downloaded = await executeConfluenceDownloadPage(
        { page_id: "20", attachments: "download" },
        context,
      );
      assert.equal(
        paths.some((path) => path.includes("/download/attachments/")),
        true,
      );
      assert.equal(
        downloaded.details?.includedCounts?.downloadedAttachments,
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns bounded page substance while preserving compact identities", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pages/20/direct-children")) {
        return Response.json({
          results: Array.from({ length: 4 }, (_, index) => ({
            id: String(21 + index),
            title: `Child ${index + 1}`,
            _links: { webui: `/spaces/SD/pages/${21 + index}` },
          })),
        });
      }
      if (url.pathname.endsWith("/pages/20/attachments")) {
        return Response.json({
          results: [
            { id: "30", title: "guide.pdf", mediaType: "application/pdf" },
          ],
        });
      }
      if (url.pathname.endsWith("/pages/20/footer-comments")) {
        return Response.json({
          results: [
            {
              id: "40",
              body: { storage: { value: "<p>Looks good</p>" } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/pages/20/inline-comments")) {
        return Response.json({ results: [] });
      }
      if (url.pathname.endsWith("/content/20/restriction/byOperation")) {
        return Response.json({ results: [] });
      }
      return Response.json({
        id: "20",
        title: "Runbook",
        body: { storage: { value: "<h1>Deploy</h1><p>Run checks</p>" } },
        _links: { webui: "/spaces/SD/pages/20" },
        properties: {
          results: [{ id: "50", key: "owner", value: { value: "Platform" } }],
        },
        labels: { results: [{ name: "runbook", prefix: "global" }] },
      });
    };
    try {
      const result = await executeConfluenceGetPage(
        {
          page_id: "20",
          include: [
            "children",
            "attachments",
            "footer_comments",
            "inline_comments",
            "properties",
            "labels",
            "restrictions",
          ],
        },
        context,
      );
      assert.match(result.content ?? "", /Body: Deploy Run checks/);
      assert.match(
        result.content ?? "",
        /https:\/\/example\.atlassian\.net\/wiki\/spaces\/SD\/pages\/20/,
      );
      assert.match(result.content ?? "", /Showing first 3 of 4/);
      assert.match(result.content ?? "", /Raw JSON saved to:/);
      assert.match(result.content ?? "", /30 · guide\.pdf/);
      assert.match(result.content ?? "", /40 — Looks good/);
      assert.equal(
        (result.details?.childPages as unknown[] | undefined)?.length,
        3,
      );
      assert.equal(result.details?.includedCounts?.directChildren, 4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

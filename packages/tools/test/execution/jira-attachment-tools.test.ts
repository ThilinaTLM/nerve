import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { executeJiraManageAttachment } from "../../src/execution/jira/jira.js";

const providerConfig = {
  enabled: true,
  siteUrl: "https://example.atlassian.net",
  email: "developer@example.com",
};

function context(cwd = process.cwd()) {
  return {
    cwd,
    getApiKey: async () => "secret-token",
    getProviderConfig: async () => providerConfig,
  };
}

describe("Jira attachment mutations", () => {
  it("uploads through the managed attachment action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-jira-attachment-"));
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "attachment body");
    const originalFetch = globalThis.fetch;
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return Response.json([
        { id: "41", filename: "renamed.txt", mimeType: "text/plain" },
      ]);
    };
    try {
      const result = await executeJiraManageAttachment(
        {
          action: "upload",
          issue_key: "PROJ-7",
          file_path: filePath,
          filename: "renamed.txt",
        },
        context(directory),
      );
      assert.equal(
        requestUrl?.pathname,
        "/rest/api/3/issue/PROJ-7/attachments",
      );
      assert.equal(requestInit?.method, "POST");
      assert.ok(requestInit?.body instanceof FormData);
      assert.equal(result.details?.action, "upload");
      assert.equal(result.details?.operation, "upload");
      assert.equal(result.details?.issueKey, "PROJ-7");
      assert.equal(
        (result.details?.attachment as { id?: string } | undefined)?.id,
        "41",
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not request Jira during a delete dry run", async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(null, { status: 204 });
    };
    try {
      const result = await executeJiraManageAttachment(
        { action: "delete", attachment_id: "42", dry_run: true },
        context(),
      );
      assert.equal(requests, 0);
      assert.equal(result.details?.action, "delete");
      assert.equal(result.details?.operation, "delete");
      assert.equal(result.details?.attachmentId, "42");
      assert.equal(result.details?.dryRun, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deletes an escaped attachment id and accepts an empty response", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = new URL(String(input));
      requestInit = init;
      return new Response(null, { status: 204 });
    };
    try {
      const result = await executeJiraManageAttachment(
        { action: "delete", attachment_id: "42/unsafe" },
        context(),
      );
      assert.equal(requestUrl?.pathname, "/rest/api/3/attachment/42%2Funsafe");
      assert.equal(requestInit?.method, "DELETE");
      assert.match(result.content ?? "", /Deleted Jira attachment 42\/unsafe/);
      assert.equal(result.details?.operation, "delete");
      assert.equal(result.details?.attachmentId, "42/unsafe");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

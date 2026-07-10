import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceBytesLabel,
  confluenceInitials,
  confluenceOutcomeBadgeTone,
  confluenceOutcomeTone,
  confluencePageUrl,
  confluenceStatusBadgeTone,
  confluenceStatusTone,
} from "./confluence-display";

describe("confluence display helpers", () => {
  it("maps statuses and outcomes to tones", () => {
    assert.equal(confluenceStatusTone("current"), "success");
    assert.equal(confluenceStatusTone("draft"), "warning");
    assert.equal(confluenceStatusTone(undefined), "muted");
    assert.equal(confluenceOutcomeTone("updated"), "success");
    assert.equal(confluenceOutcomeTone("dry_run"), "warning");
  });

  it("maps tones to badge tones", () => {
    assert.equal(confluenceStatusBadgeTone("current"), "good");
    assert.equal(confluenceStatusBadgeTone("draft"), "warn");
    assert.equal(confluenceStatusBadgeTone(undefined), "neutral");
    assert.equal(confluenceOutcomeBadgeTone("updated"), "good");
    assert.equal(confluenceOutcomeBadgeTone("dry_run"), "warn");
    assert.equal(confluenceOutcomeBadgeTone("error"), "warn");
  });

  it("builds URLs, initials, and byte labels", () => {
    assert.equal(
      confluencePageUrl("https://example.atlassian.net", "/spaces/DEV"),
      "https://example.atlassian.net/wiki/spaces/DEV",
    );
    assert.equal(
      confluencePageUrl("https://example.atlassian.net/wiki", "/spaces/DEV"),
      "https://example.atlassian.net/wiki/spaces/DEV",
    );
    assert.equal(
      confluencePageUrl("https://example.atlassian.net", "/wiki/spaces/DEV"),
      "https://example.atlassian.net/wiki/spaces/DEV",
    );
    assert.equal(
      confluencePageUrl(undefined, "https://example.test/wiki/spaces/DEV"),
      "https://example.test/wiki/spaces/DEV",
    );
    assert.equal(confluenceInitials("Developer Docs"), "DD");
    assert.equal(confluenceBytesLabel(1536), "1.5 KB");
  });
});

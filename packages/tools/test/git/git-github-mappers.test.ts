import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedMergeMethods,
  graphqlPrFileDocument,
  mapPrCommits,
  mapPrConversation,
  mapPrFiles,
  mapPrListItem,
  mapPrOverview,
  repositoryParts,
} from "../../src/git/git-github-mappers.js";
import { githubPrSearch } from "../../src/git/git-github-queries.js";
import type { GithubPrDetailRaw } from "../../src/git/git-github-queries.js";

const raw = (patch: Partial<GithubPrDetailRaw> = {}): GithubPrDetailRaw => ({
  number: 7,
  title: "Add thing",
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  baseRefName: "main",
  updatedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("GitHub mappers", () => {
  it("maps list rows with viewer review requests and null-safe defaults", () => {
    const item = mapPrListItem(
      raw({
        author: { login: "ann" },
        labels: { nodes: [{ name: "bug" }, null] },
        reviewRequests: {
          nodes: [{ requestedReviewer: { login: "me" } }, null],
        },
      }),
      "me",
    );
    assert.equal(item.author, "ann");
    assert.deepEqual(item.labels, ["bug"]);
    assert.equal(item.reviewRequested, true);
    assert.equal(item.commentCount, 0);
    assert.equal(item.headSha, "");
    assert.equal(mapPrListItem(raw(), undefined).reviewRequested, false);
  });

  it("falls back to stable ids and timestamps for conversation entries", () => {
    const conversation = mapPrConversation(
      raw({
        comments: { nodes: [{ body: "hi" }, { databaseId: 5 }] },
        reviews: { nodes: [{}] },
      }),
    );
    assert.deepEqual(
      conversation.comments.map((comment) => comment.id),
      ["comment-0", "5"],
    );
    assert.equal(conversation.comments[0]?.createdAt, "2026-01-01T00:00:00Z");
    assert.equal(conversation.reviews[0]?.id, "review-0");
    assert.equal(conversation.reviews[0]?.state, "COMMENTED");
    assert.equal(conversation.reviews[0]?.submittedAt, "2026-01-02T00:00:00Z");
  });

  it("maps overview reviewers, labels and allowed merge methods", () => {
    const settings = { squashMergeAllowed: true, rebaseMergeAllowed: true };
    assert.deepEqual(allowedMergeMethods(settings), ["squash", "rebase"]);
    const overview = mapPrOverview(
      raw({
        labels: { nodes: [{ name: "" }, { name: "x", color: "fff" }] },
        reviewRequests: {
          nodes: [
            { requestedReviewer: { slug: "team" } },
            { requestedReviewer: null },
          ],
        },
        mergeCommit: { oid: "abcdef0123" },
      }),
      settings,
      3,
    );
    assert.deepEqual(overview.labels, [{ name: "x", color: "fff" }]);
    assert.deepEqual(overview.reviewRequests, [
      { login: "team", avatarUrl: undefined },
    ]);
    assert.equal(overview.mergeCommitOid, "abcdef0123");
    assert.equal(overview.behindBy, 3);
  });

  it("maps commits, abbreviating oids and skipping empty nodes", () => {
    const { commits } = mapPrCommits(
      raw({
        commits: {
          nodes: [
            {
              commit: {
                oid: "0123456789",
                messageHeadline: "m",
                authors: { nodes: [{ name: "Ann" }] },
                author: { user: { login: "ann" } },
              },
            },
            {},
            null,
          ],
        },
      }),
    );
    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.abbrev, "0123456");
    assert.equal(commits[0]?.authorName, "Ann");
    assert.equal(commits[0]?.authorLogin, "ann");
  });

  it("maps files with status fallback, skips nameless entries and applies the limit", () => {
    const files = mapPrFiles(
      [
        { filename: "a", status: "renamed", previous_filename: "b" },
        { status: "added" },
        { filename: "c", status: "weird" },
        { filename: "d" },
      ],
      3,
    );
    assert.deepEqual(
      files.map((file) => [file.path, file.status]),
      [
        ["a", "renamed"],
        ["c", "changed"],
      ],
    );
  });

  it("classifies blob documents", () => {
    assert.deepEqual(graphqlPrFileDocument(undefined, false), {
      kind: "text",
      text: "",
    });
    assert.deepEqual(graphqlPrFileDocument(null, true), {
      kind: "unavailable",
      reason: "content-unavailable",
    });
    assert.deepEqual(graphqlPrFileDocument({ isTruncated: true }, true), {
      kind: "unavailable",
      reason: "content-too-large",
    });
    assert.deepEqual(graphqlPrFileDocument({ text: "a\0b" }, true), {
      kind: "binary",
    });
    assert.deepEqual(graphqlPrFileDocument({ text: "ok" }, true), {
      kind: "text",
      text: "ok",
    });
  });

  it("parses head repositories and builds quoted PR searches", () => {
    assert.deepEqual(repositoryParts("o/r"), { owner: "o", repo: "r" });
    assert.equal(repositoryParts("o/r/x"), undefined);
    assert.equal(repositoryParts(undefined), undefined);
    assert.equal(
      githubPrSearch({
        author: "username",
        username: 'a"b',
        reviewRequested: true,
        labels: ["x y"],
        drafts: "exclude",
        sort: "updated-asc",
      } as never),
      'is:pr is:open author:"a\\"b" review-requested:@me label:"x y" draft:false sort:updated-asc',
    );
  });
});

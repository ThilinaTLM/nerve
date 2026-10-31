import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationReference } from "@nervekit/contracts/core";
import {
  referenceSlots,
  referenceDescription,
  referenceLabel,
  referenceRepositoryLabels,
  matchConversationReference,
  referenceHttpsUrl,
} from "./conversation-references";
import { searchConversations } from "./conversation-search";

function ref(
  identifier: string,
  relationship: ConversationReference["relationship"] = "referenced",
  container = "Acme/api",
  kind = "pull_request",
): ConversationReference {
  return {
    provider: "github",
    resourceKey: `github.com/${container.toLowerCase()}#${identifier}`,
    kind,
    relationship,
    url: `https://github.com/${container}/pull/${identifier}`,
    container,
    identifier,
  };
}

const created = ref("481", "created");
const secondCreated = ref("482", "created");
const referenced = ref("77");
const secondReferenced = ref("78");
const references = [created, secondCreated, referenced, secondReferenced];

test("slots show one of each relationship in first-seen order, plus overflow", () => {
  assert.deepEqual(referenceSlots(references), {
    shown: [created, referenced],
    overflow: 2,
  });
  assert.deepEqual(referenceSlots([created, secondCreated]), {
    shown: [created, secondCreated],
    overflow: 0,
  });
  assert.deepEqual(referenceSlots([referenced]), {
    shown: [referenced],
    overflow: 0,
  });
  assert.deepEqual(referenceSlots([]), { shown: [], overflow: 0 });
});

test("matched reference leads, keeping the other relationship and input order intact", () => {
  assert.deepEqual(referenceSlots(references, secondReferenced.resourceKey), {
    shown: [secondReferenced, created],
    overflow: 2,
  });
  assert.deepEqual(referenceSlots(references, secondCreated.resourceKey), {
    shown: [secondCreated, referenced],
    overflow: 2,
  });
  assert.deepEqual(
    referenceSlots([referenced, secondReferenced], secondReferenced.resourceKey)
      .shown,
    [secondReferenced, referenced],
  );
  assert.deepEqual(referenceSlots(references, "missing").shown, [
    created,
    referenced,
  ]);
  assert.deepEqual(references, [
    created,
    secondCreated,
    referenced,
    secondReferenced,
  ]);
});

test("labels hide only the known current repository and disambiguate same-named foreign repos", () => {
  const foreign = ref("90", "referenced", "Contoso/api");
  const labels = referenceRepositoryLabels([created, foreign, secondCreated]);
  assert.equal(labels.size, 2);
  assert.equal(referenceLabel(created, labels, "GITHUB.COM/ACME/API"), "#481");
  assert.equal(referenceLabel(created, labels), "acme-api#481");
  assert.equal(
    referenceLabel(foreign, labels, "github.com/acme/api"),
    "contoso-api#90",
  );
  assert.equal(
    referenceDescription(created),
    "Created pull request Acme/api#481",
  );
  assert.equal(
    referenceDescription(ref("8", "referenced", "acme/web", "issue")),
    "Referenced issue acme/web#8",
  );
});

test("long foreign repo labels use the shared 16-character budget", () => {
  const long = ref(
    "1203",
    "referenced",
    "acme-platform-engineering/internal-shared-schema-registry",
  );
  const labels = referenceRepositoryLabels([long]);
  assert.equal(
    referenceLabel(long, labels),
    `${labels.get("github.com/acme-platform-engineering/internal-shared-schema-registry")}#1203`,
  );
  assert.ok((labels.values().next().value?.length ?? Infinity) <= 16);
});

test("reference search accepts numbers, full names and URLs, with created exact hits first", () => {
  const sameNumber = ref("481", "referenced", "other/web");
  const labels = referenceRepositoryLabels([...references, sameNumber]);
  for (const term of [
    "481",
    "#481",
    "Acme/api#481",
    "https://github.com/ACME/API/pull/481",
    "https://github.com/acme/api/issues/481?x=1",
  ]) {
    assert.equal(
      matchConversationReference([sameNumber, ...references], term, labels)
        ?.referenceKey,
      created.resourceKey,
    );
  }
  assert.ok(
    matchConversationReference([created], "481", labels)!.score >
      matchConversationReference([sameNumber], "481", labels)!.score,
  );
  for (const term of [
    "1481",
    "api#481",
    "other/web#77",
    "https://example.com/acme/api/pull/481",
  ])
    assert.equal(
      matchConversationReference(references, term, labels),
      undefined,
    );
});

test("kind and relationship words and full/short repository names match actual fields", () => {
  const issue = ref("9", "referenced", "Contoso/api", "issue");
  const unknown = ref("10", "referenced", "acme/api", "unknown");
  const labels = referenceRepositoryLabels([...references, issue]);
  for (const term of ["pr", "prs", "created", "github", "acme/api", "acme-api"])
    assert.equal(
      matchConversationReference([created], term, labels)?.referenceKey,
      created.resourceKey,
    );
  assert.equal(
    matchConversationReference([issue], "issue", labels)?.referenceKey,
    issue.resourceKey,
  );
  assert.equal(matchConversationReference([unknown], "pr", labels), undefined);
  assert.equal(
    matchConversationReference([referenced], "created", labels),
    undefined,
  );
  assert.equal(matchConversationReference([], "481", labels), undefined);
});

test("reference search composes with status/title terms; exact match selects the tag to promote", () => {
  const row = (id: string, title: string, refs: ConversationReference[]) => ({
    conversation: {
      id,
      title,
      references: refs,
      pinned: false,
      createdAt: "2026-10-31T10:00:00Z",
      lastUserMessageAt: null,
      completedAt: null,
    },
  });
  const rows = [
    row("title", "481 dashboard", []),
    row("referenced", "Dashboard", [ref("481")]),
    row("created", "Dashboard", [created]),
    row("mixed", "Backoff", references),
  ];
  const labels = referenceRepositoryLabels(references);
  const options = {
    matchField: (row: (typeof rows)[number], term: string) =>
      matchConversationReference(row.conversation.references, term, labels),
  };
  assert.deepEqual(
    searchConversations(rows, "481 dash", options).map(
      (hit) => hit.row.conversation.id,
    ),
    ["created", "referenced", "title"],
  );
  assert.equal(
    searchConversations(rows, "created 78 back", options)[0]?.referenceKey,
    secondReferenced.resourceKey,
  );
  assert.equal(searchConversations(rows, "issue 481", options).length, 0);
});

test("external links require valid https GitHub-provider URLs without credentials", () => {
  assert.equal(referenceHttpsUrl(created), created.url);
  for (const url of [
    null,
    "http://github.com/acme/api/pull/1",
    "javascript:alert(1)",
    "https://user:token@github.com/acme/api/pull/1",
    "not a url",
  ])
    assert.equal(referenceHttpsUrl({ ...created, url }), undefined);
  assert.equal(referenceHttpsUrl({ ...created, provider: "other" }), undefined);
});

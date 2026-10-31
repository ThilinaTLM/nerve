import type { ConversationReference } from "@nervekit/contracts/core";
import { repositoryLabels } from "../repository-labels";
import type { ConversationTermMatch } from "./conversation-search";

export function referenceDescription(reference: ConversationReference): string {
  const kind =
    reference.kind === "pull_request"
      ? "pull request"
      : reference.kind === "issue"
        ? "issue"
        : "reference";
  return `${reference.relationship === "created" ? "Created" : "Referenced"} ${kind} ${reference.container}#${reference.identifier}`;
}

export function referenceRepositoryKey(
  reference: ConversationReference,
): string {
  return reference.resourceKey.slice(0, reference.resourceKey.lastIndexOf("#"));
}

/** Names are shortened together, adding owners only when names collide. */
export function referenceRepositoryLabels(
  references: readonly ConversationReference[],
): Map<string, string> {
  const repositories = new Map(
    references.map((reference) => [
      referenceRepositoryKey(reference),
      reference,
    ]),
  );
  const labels = repositoryLabels(
    [...repositories].map(([id, reference]) => ({
      id,
      name: reference.container.split("/").at(-1) ?? reference.container,
      path: reference.container,
    })),
    { maxLength: 16 },
  );
  return new Map([...labels].map(([key, value]) => [key, value.label]));
}

export function referenceLabel(
  reference: ConversationReference,
  labels: ReadonlyMap<string, string>,
  currentRepository?: string,
): string {
  const key = referenceRepositoryKey(reference);
  return `${key === currentRepository?.toLowerCase() ? "" : (labels.get(key) ?? reference.container.split("/").at(-1))}#${reference.identifier}`;
}

/** Preserve first-seen order within each relationship, except for the matched tag. */
export function referenceSlots(
  references: readonly ConversationReference[],
  matchedKey?: string,
): { shown: ConversationReference[]; overflow: number } {
  const matched = references.find(
    (reference) => reference.resourceKey === matchedKey,
  );
  const shown: ConversationReference[] = matched ? [matched] : [];
  for (const relationship of ["created", "referenced"] as const) {
    if (shown.some((reference) => reference.relationship === relationship))
      continue;
    const reference = references.find(
      (reference) => reference.relationship === relationship,
    );
    if (reference) shown.push(reference);
  }
  for (const reference of references) {
    if (shown.length >= 2) break;
    if (!shown.includes(reference)) shown.push(reference);
  }
  return {
    shown: shown.slice(0, 2),
    overflow: Math.max(0, references.length - 2),
  };
}

/** Defence in depth at the external-link boundary, even for validated summary URLs. */
export function referenceHttpsUrl(
  reference: ConversationReference,
): string | undefined {
  if (reference.provider !== "github" || !reference.url) return undefined;
  try {
    const url = new URL(reference.url);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function parseReferenceTerm(
  term: string,
): { identifier: string; repository?: string; host?: string } | undefined {
  const number = term.match(/^#?(\d+)$/);
  if (number) return { identifier: number[1]!.replace(/^0+(?=\d)/, "") };
  const full = term.match(/^([^/#]+\/[^/#]+)#(\d+)$/);
  if (full)
    return {
      repository: full[1],
      identifier: full[2]!.replace(/^0+(?=\d)/, ""),
    };
  try {
    const url = new URL(term);
    const match = url.pathname.match(
      /^\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)\/?$/,
    );
    if (url.protocol === "https:" && match)
      return {
        host: url.host,
        repository: match[1],
        identifier: match[2]!.replace(/^0+(?=\d)/, ""),
      };
  } catch {
    /* Not a URL. */
  }
  return undefined;
}

export function matchConversationReference(
  references: readonly ConversationReference[],
  term: string,
  labels: ReadonlyMap<string, string>,
): ConversationTermMatch | undefined {
  const query = term.toLowerCase();
  const parsed = parseReferenceTerm(query);
  let best: ConversationTermMatch | undefined;
  for (const reference of references) {
    let score = 0;
    if (parsed) {
      if (
        reference.identifier !== parsed.identifier ||
        (parsed.repository &&
          reference.container.toLowerCase() !== parsed.repository) ||
        (parsed.host &&
          referenceRepositoryKey(reference) !==
            `${parsed.host}/${parsed.repository}`)
      )
        continue;
      score =
        (parsed.repository ? 110 : 100) +
        (reference.relationship === "created" ? 5 : 0);
    } else {
      const words = [
        reference.provider,
        ...(reference.kind === "pull_request"
          ? ["pr", "prs", "pull_request"]
          : reference.kind === "issue"
            ? ["issue"]
            : []),
        ...(reference.relationship === "created" ? ["created"] : []),
      ];
      if (query.length >= 2 && words.some((word) => word.startsWith(query)))
        score = 40;
      else if (
        query.length >= 3 &&
        [
          reference.container.toLowerCase(),
          labels.get(referenceRepositoryKey(reference)) ?? "",
        ].some((name) => name.includes(query))
      )
        score = 35;
    }
    if (score && (!best || score > best.score))
      best = { score, referenceKey: reference.resourceKey };
  }
  return best;
}

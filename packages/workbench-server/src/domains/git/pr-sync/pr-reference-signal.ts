import type { ConversationReference } from "@nervekit/contracts/core";

export function createdPrReference(
  reference: ConversationReference,
): { host: string; owner: string; repo: string; number: number } | null {
  if (reference.relationship !== "created" || !reference.url) return null;
  try {
    const url = new URL(reference.url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
    return url.hostname === "github.com" && match
      ? {
          host: url.hostname,
          owner: match[1],
          repo: match[2],
          number: Number(match[3]),
        }
      : null;
  } catch {
    return null;
  }
}

export function referenceMatchesRepository(
  reference: { host: string; owner: string; repo: string },
  repository: { hostname: string; owner: string; repo: string } | null,
): boolean {
  return (
    !!repository &&
    reference.host.toLowerCase() === repository.hostname.toLowerCase() &&
    reference.owner.toLowerCase() === repository.owner.toLowerCase() &&
    reference.repo.toLowerCase() === repository.repo.toLowerCase()
  );
}

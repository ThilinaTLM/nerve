import type { AccountKindData, PlatformUse } from "@nervekit/extension-api";

/*
 * Platforms: several account definitions (kinds) can describe accounts for the same platform, and
 * other extensions can use those accounts (`PlatformUse`). These are the pure rules; the host
 * applies them where accounts are offered, signed in and used.
 */

const TEMPLATE = /\{[A-Za-z][A-Za-z0-9.]*\}/g;

type HostToken = { literal: string } | "label" | "any";

/** The host part of an origin pattern as tokens: `*` is one host label, `{x}` any host text. */
function hostTokens(
  pattern: string,
): { scheme: string; tokens: HostToken[] } | undefined {
  const parsed = /^(https?:)\/\/([^/]+)/.exec(pattern);
  if (!parsed) return undefined;
  const tokens: HostToken[] = [];
  parsed[2].split(TEMPLATE).forEach((part, index) => {
    if (index > 0) tokens.push("any");
    part.split("*").forEach((piece, pieceIndex) => {
      if (pieceIndex > 0) tokens.push("label");
      if (piece) tokens.push({ literal: piece.toLowerCase() });
    });
  });
  return { scheme: parsed[1], tokens };
}

/** Matches without building a regular expression from manifest text. */
function matchHost(tokens: readonly HostToken[], host: string): boolean {
  const [token, ...rest] = tokens;
  if (token === undefined) return host.length === 0;
  if (typeof token === "object")
    return (
      host.startsWith(token.literal) &&
      matchHost(rest, host.slice(token.literal.length))
    );
  for (let end = 1; end <= host.length; end++) {
    if (token === "label" && host[end - 1] === ".") break;
    if (matchHost(rest, host.slice(end))) return true;
  }
  return false;
}

function hostMatches(pattern: string, origin: string): boolean {
  const expected = hostTokens(pattern);
  const actual = /^(https?:)\/\/([^/]+)$/.exec(origin);
  if (!expected || !actual || expected.scheme !== actual[1].toLowerCase())
    return false;
  return matchHost(expected.tokens, actual[2].toLowerCase());
}

const hostOf = (pattern: string): string | undefined => {
  const parsed = /^(https?:\/\/[^/]+)/.exec(pattern);
  return parsed?.[1];
};

/**
 * Whether `origin` (an origin pattern a using extension declares) lies within `definitionOrigin`
 * (an origin pattern of a definition, which may hold `*` labels and `{field}` templates). `*`
 * alone covers everything; nothing else covers `*`.
 */
export function originCovers(
  definitionOrigin: string,
  origin: string,
): boolean {
  if (definitionOrigin === "*") return true;
  if (origin === "*") return false;
  const own = hostOf(origin);
  const wide = hostOf(definitionOrigin);
  if (own === undefined || wide === undefined) return false;
  if (own.toLowerCase() === wide.toLowerCase()) return true;
  return hostMatches(definitionOrigin, own);
}

/** Whether every origin of `origins` lies within some origin of `definitionOrigins`. */
export function originsWithin(
  definitionOrigins: readonly string[],
  origins: readonly string[],
): boolean {
  return origins.every((origin) =>
    definitionOrigins.some((candidate) => originCovers(candidate, origin)),
  );
}

/**
 * Where a using extension's credential may go: the definition's (filled) origins narrowed to the
 * ones the extension declared. Without declared origins, the definition's all. It never widens.
 */
export function narrowOrigins(
  definitionOrigins: readonly string[],
  declared: readonly string[] | undefined,
): string[] {
  if (declared === undefined) return [...definitionOrigins];
  return declared.filter((origin) =>
    definitionOrigins.some((candidate) => originCovers(candidate, origin)),
  );
}

/** The scopes an `oauth2` definition asks for at sign-in. */
export const definitionScopes = (
  kind: Pick<AccountKindData, "provider">,
): string[] =>
  typeof kind.provider === "object" ? [...(kind.provider.scopes ?? [])] : [];

/** Whether accounts of `kind` can be signed in with the scopes of a use: it has an `oauth2` provider, or the use needs none. */
export function canGrantScopes(
  kind: Pick<AccountKindData, "provider">,
  use: Pick<PlatformUse, "scopes">,
): boolean {
  return (
    (use.scopes ?? []).length === 0 ||
    (typeof kind.provider === "object" && kind.provider !== null)
  );
}

/**
 * The definitions of `kinds` an extension's use of a platform may select: the platform's, whose
 * origins cover the origins the use declares, and that can be signed in with its scopes.
 */
export function kindsForUse<
  T extends Pick<AccountKindData, "platform" | "origins" | "provider">,
>(kinds: readonly T[], use: PlatformUse): T[] {
  return kinds.filter(
    (kind) =>
      kind.platform === use.platform &&
      (use.origins === undefined ||
        originsWithin(kind.origins ?? [], use.origins)) &&
      canGrantScopes(kind, use),
  );
}

/** The scopes requested at sign-in: the definition's and those of every extension using its platform. */
export function scopeUnion(
  kind: Pick<AccountKindData, "provider">,
  uses: readonly Pick<PlatformUse, "scopes">[],
): string[] {
  return [
    ...new Set([
      ...definitionScopes(kind),
      ...uses.flatMap((use) => use.scopes ?? []),
    ]),
  ];
}

/**
 * The definition as sign-in sees it: an `oauth2` provider asks for the union of scopes. Other
 * providers are returned as they are.
 */
export function withScopeUnion<
  T extends Pick<AccountKindData, "platform" | "provider">,
>(kind: T, uses: readonly (PlatformUse & { platform: string })[]): T {
  if (typeof kind.provider !== "object" || kind.platform === undefined)
    return kind;
  const platformUses = uses.filter((use) => use.platform === kind.platform);
  const scopes = scopeUnion(kind, platformUses);
  if (scopes.length === definitionScopes(kind).length) return kind;
  return { ...kind, provider: { ...kind.provider, scopes } };
}

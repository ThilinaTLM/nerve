import type {
  ExtensionConsent,
  ExtensionConsentItem,
  InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";

/**
 * What an installed extension may do, as sorted plain data: the snapshot stored at consent and
 * compared on every change. A grant is anything that widens what the extension can reach.
 */
export type GrantSnapshot = {
  /** Origins the extension may call, its accounts' credential origins included. */
  network: string[];
  capabilities: string[];
  /** Account kinds the extension defines or requires. */
  accounts: string[];
  /** Namespace id → its operations (method ids). */
  namespaces: Record<string, string[]>;
  /** Direct tool names. */
  tools: string[];
  /** UI contributions, as `<kind>:<value>`. */
  ui: string[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

export function grantSnapshot(
  manifest: InstalledExtensionManifest,
): GrantSnapshot {
  const accounts = new Set(Object.keys(manifest.accounts ?? {}));
  const network = new Set(manifest.permissions?.network ?? []);
  for (const account of Object.values(manifest.accounts ?? {}))
    for (const origin of account.origins ?? []) network.add(origin);
  const namespaces: Record<string, string[]> = {};
  for (const namespace of manifest.namespaces) {
    namespaces[namespace.id] = sorted(Object.keys(namespace.methods));
    if (namespace.requires?.account) accounts.add(namespace.requires.account);
  }
  for (const tool of manifest.tools ?? [])
    if (tool.requires?.account) accounts.add(tool.requires.account);
  const ui: string[] = [];
  for (const [kind, value] of Object.entries(manifest.ui ?? {}))
    for (const entry of Array.isArray(value) ? value : [value])
      ui.push(`${kind}:${String(entry)}`);
  return {
    network: sorted(network),
    capabilities: sorted(manifest.permissions?.capabilities ?? []),
    accounts: sorted(accounts),
    namespaces: Object.fromEntries(
      Object.entries(namespaces).sort(([a], [b]) => a.localeCompare(b)),
    ),
    tools: sorted((manifest.tools ?? []).map((tool) => tool.name)),
    ui: sorted(ui),
  };
}

/** Whether a snapshot grants nothing. */
export function isEmptyGrant(grants: GrantSnapshot): boolean {
  return (
    grants.network.length === 0 &&
    grants.capabilities.length === 0 &&
    grants.accounts.length === 0 &&
    Object.keys(grants.namespaces).length === 0 &&
    grants.tools.length === 0 &&
    grants.ui.length === 0
  );
}

/** What `next` grants that `previous` did not. Removed grants are not part of it. */
export function newGrants(
  previous: GrantSnapshot | undefined,
  next: GrantSnapshot,
): GrantSnapshot {
  const had = <T extends string>(list: readonly T[] | undefined) =>
    new Set(list ?? []);
  const only = (before: readonly string[] | undefined, after: string[]) => {
    const seen = had(before);
    return after.filter((value) => !seen.has(value));
  };
  const namespaces: Record<string, string[]> = {};
  for (const [id, methods] of Object.entries(next.namespaces)) {
    const before = previous?.namespaces[id];
    // A new namespace is new in full; an existing one only for its new operations.
    const added = only(before, methods);
    if (before === undefined || added.length > 0) namespaces[id] = added;
  }
  return {
    network: only(previous?.network, next.network),
    capabilities: only(previous?.capabilities, next.capabilities),
    accounts: only(previous?.accounts, next.accounts),
    namespaces,
    tools: only(previous?.tools, next.tools),
    ui: only(previous?.ui, next.ui),
  };
}

const capabilityText: Record<string, string> = {
  "models.vision": "Uses a vision model",
  "models.image": "Uses the image generation model",
};

const list = (values: readonly string[]) => values.join(", ");

/**
 * The review text of a set of grants, in plain language. With `previous` unset it describes the
 * whole manifest; for an update the caller passes the difference (`newGrants`).
 */
export function consentItems(
  grants: GrantSnapshot,
  manifest: InstalledExtensionManifest,
): ExtensionConsentItem[] {
  const items: ExtensionConsentItem[] = [];
  for (const origin of grants.network)
    items.push(
      origin.includes("*")
        ? {
            kind: "network",
            text:
              origin === "*"
                ? "Connects to any host on the internet (broad access)"
                : `Connects to every host matching ${origin} (broad access)`,
            broad: true,
          }
        : { kind: "network", text: `Connects to ${origin}` },
    );
  for (const kind of grants.accounts) {
    const label = manifest.accounts?.[kind]?.label ?? kind;
    items.push({
      kind: "account",
      text: `Uses your ${/account$/i.test(label) ? label : `${label} account`} (account kind ${kind})`,
    });
  }
  for (const capability of grants.capabilities)
    items.push({
      kind: "capability",
      text: capabilityText[capability] ?? `Uses ${capability}`,
    });
  if (grants.tools.length > 0)
    items.push({
      kind: "tools",
      text: `Adds agent tools: ${list(grants.tools)}`,
    });
  for (const [id, operations] of Object.entries(grants.namespaces))
    items.push({
      kind: "namespace",
      text:
        operations.length === 0
          ? `Adds SDK namespace ${id}`
          : `Adds SDK namespace ${id} (operations ${list(operations)})`,
    });
  for (const entry of grants.ui) {
    const [kind, ...rest] = entry.split(":");
    const value = rest.join(":");
    items.push({
      kind: "ui",
      text:
        kind === "themes"
          ? `Adds the color theme file ${value}`
          : `Adds the interface contribution ${kind} (${value})`,
    });
  }
  return items;
}

/** The consent of a pending extension; `previous` is the last consented snapshot of an update. */
export function buildConsent(input: {
  manifest: InstalledExtensionManifest;
  contentHash: string;
  /** The grants of the last consent; absent for a first consent. */
  previous?: GrantSnapshot;
}): ExtensionConsent {
  const { manifest, previous } = input;
  const current = grantSnapshot(manifest);
  const update = previous !== undefined;
  const items = consentItems(
    update ? newGrants(previous, current) : current,
    manifest,
  );
  if (update && items.length === 0)
    items.push({
      kind: "code",
      text: "The extension's code changed; it asks for nothing new",
    });
  if (!update && items.length === 0)
    items.push({
      kind: "code",
      text: "Runs its own code; it asks for no network, account or tool access",
    });
  return {
    update,
    contentHash: input.contentHash,
    items,
    text: items.map((item) => `- ${item.text}`).join("\n"),
  };
}

import type {
  ExtensionConsent,
  ExtensionConsentItem,
  ExtensionGrantSnapshot,
  InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";

/** What an installed extension may do, as sorted plain data (the `grants` of its trust decision). */
export type GrantSnapshot = ExtensionGrantSnapshot;

/**
 * UI contributions as grants: `previews:<id>:<extension>` per file type, `previews-edit:<id>` for
 * a preview that writes the file itself (`edit: "custom"`), `pages:<id>`, `panels:<id>`,
 * `themes:<id>`. Widening the file types or adding custom editing asks again; narrowing does not.
 */
function uiGrants(manifest: InstalledExtensionManifest): string[] {
  const ui = manifest.ui;
  return [
    ...(ui?.previews ?? []).flatMap((p) => [
      ...p.match.extensions.map((extension) => `previews:${p.id}:${extension}`),
      ...(p.edit === "custom" ? [`previews-edit:${p.id}`] : []),
    ]),
    ...(ui?.pages ?? []).map((p) => `pages:${p.id}`),
    ...(ui?.panels ?? []).map((p) => `panels:${p.id}`),
    ...(ui?.themes ?? []).map((t) => `themes:${t.id}`),
  ];
}

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
  const ui = uiGrants(manifest);
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
  const previewTypes = new Map<string, string[]>();
  const customEdit = new Set<string>();
  for (const entry of grants.ui) {
    const [kind, id = "", ...rest] = entry.split(":");
    if (kind === "previews") {
      previewTypes.set(id, [...(previewTypes.get(id) ?? []), rest.join(":")]);
    } else if (kind === "previews-edit") {
      customEdit.add(id);
      if (!previewTypes.has(id)) previewTypes.set(id, []);
    } else if (kind === "pages") {
      const label = manifest.ui?.pages?.find((p) => p.id === id)?.label ?? id;
      items.push({
        kind: "ui",
        text: `Adds a page "${label}" to the workbench`,
      });
    } else if (kind === "panels") {
      const label = manifest.ui?.panels?.find((p) => p.id === id)?.label ?? id;
      items.push({ kind: "ui", text: `Adds a side panel "${label}"` });
    } else if (kind === "themes") {
      const label = manifest.ui?.themes?.find((t) => t.id === id)?.label ?? id;
      items.push({ kind: "ui", text: `Adds the color theme "${label}"` });
    }
  }
  for (const [id, types] of previewTypes) {
    const preview = manifest.ui?.previews?.find((p) => p.id === id);
    const label = preview?.label ?? id;
    const custom = customEdit.has(id);
    const opens =
      types.length > 0
        ? `Opens ${list(types)} files as "${label}"`
        : `Opens files as "${label}"`;
    items.push({
      kind: "ui",
      text: custom ? `${opens}; can change the file you open it with` : opens,
      ...(custom ? { broad: true } : {}),
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

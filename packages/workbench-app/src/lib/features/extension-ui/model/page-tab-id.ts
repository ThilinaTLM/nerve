import type { BridgeJson } from "@nervekit/contracts/extensions";

/** Canonical JSON: object keys sorted, so equal params always give one tab. */
function stableJson(value: BridgeJson): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * The center-tab id of an extension page: `<extension-id>/<page-id>`, plus `?<params>` when the
 * page was opened with params. Params are part of the id so each distinct set is its own tab
 * and a restored tab keeps them.
 */
export function extensionPageTabId(
  extensionId: string,
  pageId: string,
  params?: BridgeJson,
): string {
  const base = `${extensionId}/${pageId}`;
  if (params === undefined || params === null) return base;
  return `${base}?${encodeURIComponent(stableJson(params))}`;
}

export type ExtensionPageTabRef = {
  extensionId: string;
  pageId: string;
  params?: BridgeJson;
};

export function parseExtensionPageTabId(
  id: string,
): ExtensionPageTabRef | undefined {
  const match = /^([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)(?:\?(.*))?$/.exec(id);
  if (!match) return undefined;
  const [, extensionId, pageId, encoded] = match;
  if (encoded === undefined) return { extensionId, pageId };
  try {
    return {
      extensionId,
      pageId,
      params: JSON.parse(decodeURIComponent(encoded)) as BridgeJson,
    };
  } catch {
    return undefined;
  }
}

/** Panel views in the dock layout are `ext:<extension-id>/<panel-id>`. */
export function extensionPanelViewId(
  extensionId: string,
  panelId: string,
): string {
  return `ext:${extensionId}/${panelId}`;
}

export function parseExtensionPanelViewId(
  viewId: string,
): { extensionId: string; panelId: string } | undefined {
  const match = /^ext:([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(viewId);
  return match ? { extensionId: match[1], panelId: match[2] } : undefined;
}

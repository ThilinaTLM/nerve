import type { ExtensionsView } from "@nervekit/contracts/extensions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/**
 * The account each `account` setting of the user's extensions selects, for
 * features outside the Extensions page. Kept current by
 * `publishUserExtensions`, which every user-scope load and save calls.
 */
const selected = $state<Record<string, string>>({});

const slot = (extensionId: string, field: string) => `${extensionId}.${field}`;

export function publishUserExtensions(view: ExtensionsView): void {
  if (view.target.scope !== "user") return;
  for (const extension of view.extensions)
    for (const [field, schema] of Object.entries(
      extension.settingsSchema.fields,
    )) {
      if (schema.type !== "account") continue;
      const value = extension.fields[field]?.value;
      const key = slot(extension.metadata.id, field);
      if (typeof value === "string" && value) selected[key] = value;
      else delete selected[key];
    }
}

/** Id of the account the user's `account` setting selects, if any. */
export function selectedAccountId(
  extensionId: string,
  field: string,
): string | undefined {
  return selected[slot(extensionId, field)];
}

export async function refreshSelectedAccounts(): Promise<void> {
  publishUserExtensions(
    await requestWorkbench("extensions.get", { target: { scope: "user" } }),
  );
}

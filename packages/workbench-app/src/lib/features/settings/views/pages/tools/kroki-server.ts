import {
  defaultKrokiToolSettings,
  krokiToolSettingsSchema,
} from "@nervekit/contracts/settings";

const publicKrokiHost = new URL(defaultKrokiToolSettings.url).hostname;

/** Whether the URL points at the shared public Kroki service. */
export function isPublicKrokiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === publicKrokiHost;
  } catch {
    return false;
  }
}

/** Whether the URL is a valid Kroki server setting. */
export function isValidKrokiUrl(url: string): boolean {
  return krokiToolSettingsSchema.safeParse({ url }).success;
}

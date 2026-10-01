import { defaultKrokiToolSettings } from "@nervekit/contracts/settings";

const publicKrokiHost = new URL(defaultKrokiToolSettings.url).hostname;

/** Whether the URL points at the shared public Kroki service. */
export function isPublicKrokiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === publicKrokiHost;
  } catch {
    return false;
  }
}

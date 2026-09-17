import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";

export async function readClipboardText(): Promise<string> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.clipboard.readText();

  const clipboardApi = globalThis.navigator?.clipboard;
  if (clipboardApi?.readText) return clipboardApi.readText();

  throw new Error("Clipboard API is not available.");
}

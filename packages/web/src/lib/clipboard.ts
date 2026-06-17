import { getDesktopBridge } from "$lib/features/desktop/state/desktop-bridge.svelte";

export async function writeClipboardText(text: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge) {
    await bridge.clipboard.writeText(text);
    return;
  }

  const clipboardApi = globalThis.navigator?.clipboard;
  if (clipboardApi?.writeText) {
    await clipboardApi.writeText(text);
    return;
  }

  throw new Error("Clipboard API is not available.");
}

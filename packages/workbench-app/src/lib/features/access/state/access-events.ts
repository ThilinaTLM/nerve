import type { Device } from "@nervekit/contracts/access";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { notifyToast } from "$lib/application/notifications/notify.svelte";
import { devicePairedMessage } from "./device-format";

export function registerAccessEventHandlers(): () => void {
  return onEvent("access.device_paired", (event) => {
    const device = (event.data as { device?: Device }).device;
    if (device?.name)
      notifyToast(devicePairedMessage(device.name), { kind: "success" });
  });
}

import type { Device, TunnelStatus } from "@nervekit/contracts/access";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { notifyToast } from "$lib/application/notifications/notify.svelte";
import { setTunnelStatus } from "$lib/application/workspace";
import { devicePairedMessage } from "./device-format";

export function registerAccessEventHandlers(): () => void {
  const offPaired = onEvent("access.device_paired", (event) => {
    const device = (event.data as { device?: Device }).device;
    if (device?.name)
      notifyToast(devicePairedMessage(device.name), { kind: "success" });
  });
  const offTunnel = onEvent("access.tunnel_changed", (event) => {
    const status = (event.data as { status?: TunnelStatus }).status;
    if (status) setTunnelStatus(status);
  });
  return () => {
    offPaired();
    offTunnel();
  };
}

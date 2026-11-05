import type {
  AccessAuditEvent,
  AccessSession,
  DeviceView,
  PairingCode,
  Passkey,
} from "@nervekit/contracts/access";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { ControllerLifecycle } from "$lib/platform/lifecycle/controller-lifecycle";
import {
  createPairingCode,
  getAccessSession,
  listAuditEvents,
  listDevices,
  listPasskeys,
  removePasskey,
  renameDevice,
  revokeAllDevices,
  revokeDevice,
} from "../api/access.api";
import { addPasskey } from "./access-actions";
import { describeAccessError } from "./access-errors";

/** State behind Settings → Devices. */
export class DevicesPageController {
  devices = $state<DeviceView[]>([]);
  passkeys = $state<Passkey[]>([]);
  audit = $state<AccessAuditEvent[]>([]);
  session = $state<AccessSession | undefined>();
  legacyBearerSeen = $state(false);
  loading = $state(true);
  errorMessage = $state<string | undefined>();
  pairing = $state<PairingCode | undefined>();
  #life = new ControllerLifecycle();

  start(): void {
    this.#life.restart((scope) => {
      void this.load();
      const refresh = () => void this.load();
      scope.onDispose(onEvent("access.device_paired", refresh));
      scope.onDispose(onEvent("access.device_revoked", refresh));
      scope.onDispose(onEvent("access.passkeys_changed", refresh));
    });
  }

  dispose(): void {
    this.#life.dispose();
  }

  async load(): Promise<void> {
    const isCurrent = this.#life.capture();
    try {
      const [devices, passkeys, audit, session] = await Promise.all([
        listDevices(),
        listPasskeys(),
        listAuditEvents(30),
        getAccessSession(),
      ]);
      if (!isCurrent()) return;
      this.devices = devices.devices;
      this.legacyBearerSeen = devices.legacyBearerSeen;
      this.passkeys = passkeys;
      this.audit = audit;
      this.session = session;
      this.errorMessage = undefined;
    } catch (error) {
      if (isCurrent()) this.errorMessage = describeAccessError(error);
    } finally {
      if (isCurrent()) this.loading = false;
    }
  }

  /** Runs a mutation, then reloads; failures surface in the page banner. */
  async #mutate(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      this.errorMessage = undefined;
      await this.load();
      return true;
    } catch (error) {
      this.errorMessage = describeAccessError(error);
      return false;
    }
  }

  rename(id: string, name: string): Promise<boolean> {
    return this.#mutate(() => renameDevice(id, name));
  }

  /** Revokes an active device or dismisses an expired one. */
  revoke(id: string): Promise<boolean> {
    return this.#mutate(() => revokeDevice(id));
  }

  revokeOthers(): Promise<boolean> {
    return this.#mutate(() => revokeAllDevices(true));
  }

  removePasskey(id: string): Promise<boolean> {
    return this.#mutate(() => removePasskey(id));
  }

  addPasskey(name: string): Promise<boolean> {
    return this.#mutate(() => addPasskey(name));
  }

  /** Throws so the pairing dialog can show the error inline. */
  async createPairing(): Promise<PairingCode> {
    this.pairing = await createPairingCode("mobile");
    return this.pairing;
  }
}

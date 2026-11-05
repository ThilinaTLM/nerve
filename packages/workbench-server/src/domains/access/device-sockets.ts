/** Live WebSockets by principal, so revoking a device (or rotating the local token) ends its sessions. */
export interface ClosableSocket {
  close(code?: number, reason?: string): void;
}

const LOCAL_KEY = "local";

export class DeviceSockets {
  readonly #byKey = new Map<string, Set<ClosableSocket>>();

  track(
    principal: { kind: "local" } | { kind: "device"; deviceId: string },
    socket: ClosableSocket,
  ): () => void {
    const key = principal.kind === "local" ? LOCAL_KEY : principal.deviceId;
    let set = this.#byKey.get(key);
    if (!set) {
      set = new Set();
      this.#byKey.set(key, set);
    }
    set.add(socket);
    return () => {
      set.delete(socket);
      if (set.size === 0 && this.#byKey.get(key) === set)
        this.#byKey.delete(key);
    };
  }

  closeDevice(deviceId: string): number {
    return this.#close(deviceId);
  }

  closeLocal(): number {
    return this.#close(LOCAL_KEY);
  }

  closeAll(except?: string): number {
    let closed = 0;
    for (const key of [...this.#byKey.keys()]) {
      if (key !== except) closed += this.#close(key);
    }
    return closed;
  }

  #close(key: string): number {
    const set = this.#byKey.get(key);
    if (!set) return 0;
    this.#byKey.delete(key);
    for (const socket of set) {
      try {
        // 4401: application-defined "credential revoked".
        socket.close(4401, "Credential revoked");
      } catch {
        // Already closing.
      }
    }
    return set.size;
  }
}

import type { SandboxDaemonStatus } from "@nervekit/contracts";
export class DaemonStatusMachine {
  status: SandboxDaemonStatus = "booting";
  transition(next: SandboxDaemonStatus): void {
    this.status = next;
  }
}

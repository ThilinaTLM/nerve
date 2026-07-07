import type { SandboxDaemonStatus } from "@nervekit/shared";
export class DaemonStatusMachine {
  status: SandboxDaemonStatus = "booting";
  transition(next: SandboxDaemonStatus): void {
    this.status = next;
  }
}

export class FlowControl {
  private inFlight = 0;
  constructor(private readonly maxInFlight = 8) {}
  canSend(): boolean {
    return this.inFlight < this.maxInFlight;
  }
  sent(): void {
    this.inFlight += 1;
  }
  acked(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

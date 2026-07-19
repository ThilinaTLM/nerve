export type WorkbenchSubagentCancel = () => Promise<void> | void;

/** Non-authoritative live cancellation handles keyed by the owning parent run. */
export class WorkbenchSubagentExecutions {
  private readonly entries = new Map<
    string,
    Map<string, WorkbenchSubagentCancel>
  >();

  register(
    parentRunId: string,
    childRunId: string,
    cancel: WorkbenchSubagentCancel,
  ): () => void {
    let children = this.entries.get(parentRunId);
    if (!children) {
      children = new Map();
      this.entries.set(parentRunId, children);
    }
    children.set(childRunId, cancel);
    return () => {
      const current = this.entries.get(parentRunId);
      current?.delete(childRunId);
      if (current?.size === 0) this.entries.delete(parentRunId);
    };
  }

  async cancelRun(parentRunId: string): Promise<number> {
    const children = [...(this.entries.get(parentRunId)?.values() ?? [])];
    if (children.length === 0) return 0;
    // Calling every handle before awaiting Promise.all ensures each child's
    // AbortController is tripped in the same cancellation turn.
    const cancellations = children.map((cancel) => Promise.resolve(cancel()));
    await Promise.all(cancellations);
    return children.length;
  }
}

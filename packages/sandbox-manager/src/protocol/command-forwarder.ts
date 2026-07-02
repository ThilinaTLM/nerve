export class CommandForwarder {
  private readonly pending = new Map<string, (value: unknown) => void>();
  send(
    socket: { send(data: string): void },
    method: string,
    params: unknown,
    id = `req_${Date.now()}`,
  ): Promise<unknown> {
    socket.send(JSON.stringify({ type: "request", id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  resolve(id: string, value: unknown): void {
    this.pending.get(id)?.(value);
    this.pending.delete(id);
  }
}

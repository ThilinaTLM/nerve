export type CriticalErrorRequest = {
  id: number;
  title: string;
  details: string;
};

export class CriticalErrorQueue {
  current?: CriticalErrorRequest;
  queue: CriticalErrorRequest[] = [];
  private nextId = 1;

  show(title: string, details: string): void {
    const normalizedDetails = details.trim() || "An unknown error occurred.";
    const existing =
      this.current?.title === title
        ? this.current
        : this.queue.find((request) => request.title === title);
    if (existing) {
      if (!existing.details.split("\n\n").includes(normalizedDetails))
        existing.details += `\n\n${normalizedDetails}`;
      return;
    }
    const request = {
      id: this.nextId++,
      title,
      details: normalizedDetails,
    };
    if (!this.current) this.current = request;
    else this.queue.push(request);
  }

  acknowledge(): void {
    this.current = this.queue.shift();
  }

  reset(): void {
    this.current = undefined;
    this.queue = [];
    this.nextId = 1;
  }
}

export function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  const details = String(error);
  return details.trim() || "An unknown error occurred.";
}

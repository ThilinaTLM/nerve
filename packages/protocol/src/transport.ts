export type TransportState = "connecting" | "open" | "closing" | "closed";

export interface TransportClose {
  readonly code?: number;
  readonly reason?: string;
  readonly clean?: boolean;
}

export interface TransportConnection {
  readonly state: TransportState;
  send(frame: string): void | Promise<void>;
  close(code?: number, reason?: string): void | Promise<void>;
  onMessage(listener: (frame: string) => void): () => void;
  onClose(listener: (close: TransportClose) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
}

export interface TransportFactory {
  connect(signal?: AbortSignal): Promise<TransportConnection>;
}

export type LogStreamTone = "default" | "warn" | "error";

/** One rendered output line. `key` must stay stable while the line is retained. */
export type LogStreamLine = {
  key: string;
  text: string;
  tone?: LogStreamTone;
  /** Passed through to terminal styling hooks. */
  stream?: "stdout" | "stderr";
  level?: "info" | "warn" | "error";
};

export function logStreamToneClass(tone: LogStreamTone | undefined): string {
  if (tone === "error") return "text-destructive";
  if (tone === "warn") return "text-warning";
  return "text-foreground";
}

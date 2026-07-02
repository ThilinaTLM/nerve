import { Redactor } from "../security/redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class SandboxLogger {
  constructor(
    private readonly level: LogLevel = "info",
    private readonly redactor = new Redactor(),
  ) {}
  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }
  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }
  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }
  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }
  private log(level: LogLevel, message: string, data?: unknown): void {
    if (order[level] < order[this.level]) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      message: this.redactor.redactText(message),
      ...(data === undefined ? {} : { data: this.redactor.redact(data) }),
    };
    const line = JSON.stringify(record);
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  }
}

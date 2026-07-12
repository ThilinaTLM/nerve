import { createHash } from "node:crypto";
import type { RunIntegrityPort } from "@nervekit/host-runtime";

export class WorkbenchRunIntegrity implements RunIntegrityPort {
  checksum(value: unknown): string {
    return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

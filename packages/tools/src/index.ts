import type { ToolRisk } from "@nerve/shared";

export interface ToolDescriptor {
  name: string;
  risk: ToolRisk;
  description: string;
}

export const coreToolPlaceholders: ToolDescriptor[] = [
  { name: "read", risk: "read", description: "Read file contents." },
  {
    name: "write",
    risk: "workspace_write",
    description: "Write workspace files.",
  },
  {
    name: "bash",
    risk: "command",
    description: "Run a bounded shell command.",
  },
];

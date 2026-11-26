import type { McpGrantSnapshot } from "@nervekit/contracts/mcp";
import {
  mcpReviewNotes,
  mcpSendsSentences,
} from "../../../domains/mcp/mcp-config.js";
import { code, line, type ReviewLine } from "./review-lines.js";

/**
 * The lines of an MCP entry, from the grants the MCP review computes (what runs, what is sent out
 * of the machine, what changes the environment). Variables that change what runs are broad.
 */
export function mcpLines(grants: McpGrantSnapshot): ReviewLine[] {
  const lines: ReviewLine[] = [];
  if (grants.transport === "stdio") {
    const command = [grants.command, ...(grants.args ?? [])]
      .filter((part): part is string => part !== undefined)
      .join(" ");
    lines.push(
      line(`Runs ${code(command)} on this computer`, false, "Runs a program"),
    );
  } else if (grants.url)
    lines.push(
      line(`Connects to ${code(grants.url)}`, false, "Connects to a server"),
    );
  if (grants.inheritsEnvironment)
    lines.push(
      line(
        "Starts with all of Nerve's environment variables",
        true,
        "Gets all your variables",
      ),
    );
  for (const note of mcpReviewNotes(grants))
    // The whole-environment note is the line above.
    if (!note.startsWith("Starts "))
      lines.push(line(withoutPeriod(note), true, "Changes what runs"));
  for (const sentence of mcpSendsSentences(grants))
    lines.push(line(withoutPeriod(sentence), false, "Sends a value out"));
  return lines;
}

const withoutPeriod = (text: string) => text.replace(/\.$/, "");

import { projectProcessText } from "../../result-projection/process-output.js";
import type { ProcessRecoveryFiles } from "./process-result.js";

/** Matches the process policy: status after the output inline, status above a reduced head/tail view. */
export function projectAgentContent({
  profile,
  combined,
  stdout,
  stderr,
  footerLines,
  status,
  recovery,
  fullOutputPath,
}: {
  profile: "process_diagnostics" | "script_output";
  combined: string;
  stdout: string;
  stderr: string;
  footerLines: string[];
  status: (string | undefined)[];
  recovery?: ProcessRecoveryFiles;
  fullOutputPath?: string;
}) {
  const header = [...footerLines, ...status]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const body = footerLines.length
    ? `${combined}${combined.endsWith("\n") ? "" : "\n"}${footerLines.join("\n")}`
    : combined;
  const statusText = status.filter(Boolean).join("\n");
  const combinedPath = recovery?.combinedPath ?? fullOutputPath;
  return projectProcessText({
    header,
    inline: `${body}\n\n${statusText}`,
    output: combined,
    files: combinedPath
      ? { combined: { path: combinedPath, text: combined } }
      : {
          stdout: recovery
            ? { path: recovery.stdoutPath, text: stdout }
            : undefined,
          stderr: recovery
            ? { path: recovery.stderrPath, text: stderr }
            : undefined,
        },
    profile,
  });
}

import { parentPort, workerData } from "node:worker_threads";
import { NodeHtmlMarkdown } from "node-html-markdown";

interface WorkerInput {
  source: string;
  maxOutputBytes: number;
}

type WorkerResult =
  | { ok: true; markdown: string }
  | { ok: false; code: string; message: string };

function execute(input: WorkerInput): WorkerResult {
  try {
    const markdown = new NodeHtmlMarkdown().translate(input.source).trim();
    if (Buffer.byteLength(markdown, "utf8") > input.maxOutputBytes) {
      return {
        ok: false,
        code: "HTML_CONVERSION_OUTPUT_TOO_LARGE",
        message: "Converted Markdown exceeds the 8 MiB output limit.",
      };
    }
    return { ok: true, markdown };
  } catch (error) {
    return {
      ok: false,
      code: "HTML_CONVERSION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!parentPort) {
  throw new Error("HTML conversion worker requires a parent port.");
}

parentPort.postMessage(execute(workerData as WorkerInput));

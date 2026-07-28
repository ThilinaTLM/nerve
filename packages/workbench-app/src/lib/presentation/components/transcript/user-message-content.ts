import {
  findExecutableCommandBlocks,
  findInlineCommandResultBlocks,
} from "@nervekit/contracts";

export type UserMessageSegment =
  | { kind: "text"; text: string }
  | {
      kind: "command_result";
      command: string;
      status: string;
      exitCode?: number;
      output: string;
    }
  | { kind: "command_pending"; command: string };

type PositionedSegment = {
  start: number;
  end: number;
  segment: UserMessageSegment;
};

const NO_OUTPUT_PLACEHOLDER = "(no output)";

/**
 * Split a user prompt into plain-text runs, executed inline-command result
 * blocks (already expanded server-side), and raw `!!!` blocks that have not
 * executed yet (optimistic rows and historical un-expanded prompts).
 */
export function segmentUserMessageText(text: string): UserMessageSegment[] {
  const results: PositionedSegment[] = findInlineCommandResultBlocks(text).map(
    (block) => ({
      start: block.start,
      end: block.end,
      segment: {
        kind: "command_result",
        command: block.command,
        status: block.status,
        exitCode: block.exitCode,
        output: block.output === NO_OUTPUT_PLACEHOLDER ? "" : block.output,
      },
    }),
  );
  // Raw `!!!` blocks can appear inside a result block's output (e.g. after
  // catting a file); keep those as part of the result output.
  const pending: PositionedSegment[] = findExecutableCommandBlocks(text)
    .filter(
      (block) =>
        !results.some(
          (result) => block.start < result.end && block.end > result.start,
        ),
    )
    .map((block) => ({
      start: block.start,
      end: block.end,
      segment: { kind: "command_pending", command: block.command },
    }));

  const blocks = [...results, ...pending].sort((a, b) => a.start - b.start);
  if (blocks.length === 0) return [{ kind: "text", text }];

  const segments: UserMessageSegment[] = [];
  let cursor = 0;
  for (const block of blocks) {
    pushText(segments, text.slice(cursor, block.start));
    segments.push(block.segment);
    cursor = block.end;
  }
  pushText(segments, text.slice(cursor));
  return segments;
}

function pushText(segments: UserMessageSegment[], raw: string): void {
  const text = raw.replace(/^\n+/, "").replace(/\n+$/, "");
  if (text.length > 0) segments.push({ kind: "text", text });
}

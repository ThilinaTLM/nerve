export type ParsedStashMessage = {
  title: string;
  branch?: string;
  wip: boolean;
};

const WIP_PATTERN = /^WIP on ([^:]+): [0-9a-f]{4,40}(?: (.*))?$/s;
const ON_PATTERN = /^On ([^:]+): (.*)$/s;

/** Splits git's stash subject into a readable title and the source branch. */
export function parseStashMessage(message: string): ParsedStashMessage {
  const raw = message.trim();
  const wip = WIP_PATTERN.exec(raw);
  if (wip) {
    const title = wip[2]?.trim();
    return { title: title || raw, branch: wip[1], wip: true };
  }
  const on = ON_PATTERN.exec(raw);
  if (on) {
    const title = on[2]?.trim();
    return { title: title || raw, branch: on[1], wip: false };
  }
  return { title: raw, wip: false };
}

export interface Flags {
  scenario: "open" | "stream";
  cdp: string;
  runs: number;
  out: string;
  conversation: string;
  search: string;
  project: string;
  reload: boolean;
  profile: boolean;
  model: string;
  noNetwork: boolean;
  prompt: string | undefined;
  timeoutSec: number;
}

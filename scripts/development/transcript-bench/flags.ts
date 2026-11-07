export interface Flags {
  scenario: "open" | "stream" | "heap";
  cdp: string;
  runs: number;
  out: string;
  conversation: string;
  search: string;
  project: string;
  reload: boolean;
  profile: boolean;
  trace: boolean;
  model: string;
  noNetwork: boolean;
  prompt: string | undefined;
  timeoutSec: number;
  snapshots: boolean;
}

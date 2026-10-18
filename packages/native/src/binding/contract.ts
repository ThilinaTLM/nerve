import type { NativeGitBinding } from "../git/binding.js";
import type { NativeMonitorBinding } from "../monitor/binding.js";
import type { NativeProcessBinding } from "../process/binding.js";
import type { NativeSearchBinding } from "../search/binding.js";

export type {
  NativeOutputEvent,
  NativeOutputDrain,
  NativeProcessHandle,
} from "../process/binding.js";
export type { NativeChangeMonitorHandle } from "../monitor/binding.js";

export interface NativeBinding
  extends
    NativeGitBinding,
    NativeMonitorBinding,
    NativeProcessBinding,
    NativeSearchBinding {
  runtimeCapabilities(): { platform: string; capabilities: string[] };
}

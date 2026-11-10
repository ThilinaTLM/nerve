import type { NativeFilesBinding } from "../files/binding.js";
import type { NativeGitBinding } from "../git/binding.js";
import type { NativeImageBinding } from "../image/binding.js";
import type { NativeMonitorBinding } from "../monitor/binding.js";
import type { NativeProcessBinding } from "../process/binding.js";
import type { NativeSandboxBinding } from "../sandbox/binding.js";
import type { NativeSearchBinding } from "../search/binding.js";

export interface NativeBinding
  extends
    NativeFilesBinding,
    NativeGitBinding,
    NativeImageBinding,
    NativeMonitorBinding,
    NativeProcessBinding,
    NativeSandboxBinding,
    NativeSearchBinding {
  runtimeCapabilities(): { platform: string; capabilities: string[] };
}

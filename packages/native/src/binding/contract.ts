import type { GitNativeBinding } from "../git/native-contract.js";
import type { ProcessNativeBinding } from "../process/native-contract.js";

export interface NativeBinding extends GitNativeBinding, ProcessNativeBinding {
  runtimeCapabilities(): { platform: string; capabilities: string[] };
}

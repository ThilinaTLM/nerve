import { binding } from "./binding/loader.js";

export function nativeRuntimeCapabilities(): {
  platform: string;
  capabilities: string[];
} {
  return binding.runtimeCapabilities();
}

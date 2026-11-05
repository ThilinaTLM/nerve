import type { DeviceKind } from "@nervekit/contracts/access";

const MOBILE_PATTERN = /android|iphone|ipad|ipod|mobile/i;

interface Detected {
  browser: string;
  platform: string;
}

function detectBrowser(ua: string): string {
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Browser";
}

function detectPlatform(ua: string): string {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux|x11/i.test(ua)) return "Linux";
  return "";
}

function detect(userAgent: string): Detected {
  return {
    browser: detectBrowser(userAgent),
    platform: detectPlatform(userAgent),
  };
}

/** Suggested device name, e.g. "Chrome on Android". The user can edit it. */
export function defaultDeviceName(userAgent: string): string {
  const { browser, platform } = detect(userAgent);
  return platform ? `${browser} on ${platform}` : browser;
}

export function deviceKindFor(userAgent: string): DeviceKind {
  return MOBILE_PATTERN.test(userAgent) ? "mobile" : "browser";
}

export function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export type ShortcutBinding = {
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform.toLowerCase();
  return platform.includes("mac") || navigator.userAgent.includes("Mac OS X");
}

function normalizedKey(key: string): string {
  if (key === " ") return "space";
  if (key === "Esc") return "escape";
  return key.toLowerCase();
}

function keyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  switch (code) {
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "Period":
      return ".";
    case "Enter":
    case "NumpadEnter":
      return "enter";
    case "Escape":
      return "escape";
    default:
      return undefined;
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'input, textarea, select, [contenteditable="true"], .cm-editor',
  );
  return Boolean(editable);
}

export function matchesShortcut(
  event: KeyboardEvent,
  binding: ShortcutBinding,
): boolean {
  const mac = isMacPlatform();
  const expectedCtrl = Boolean(binding.ctrl || (binding.mod && !mac));
  const expectedMeta = Boolean(binding.meta || (binding.mod && mac));
  const expectedAlt = Boolean(binding.alt);
  const expectedShift = Boolean(binding.shift);

  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.metaKey !== expectedMeta) return false;
  if (event.altKey !== expectedAlt) return false;
  if (event.shiftKey !== expectedShift) return false;

  const expectedKey = normalizedKey(binding.key);
  return (
    normalizedKey(event.key) === expectedKey ||
    normalizedKey(keyFromCode(event.code) ?? "") === expectedKey
  );
}

function displayKey(key: string): string {
  const normalized = normalizedKey(key);
  if (normalized === "escape") return "Esc";
  if (normalized === "enter") return "Enter";
  if (normalized === "space") return "Space";
  if (normalized.length === 1) return normalized.toUpperCase();
  return key;
}

export function formatShortcut(binding: ShortcutBinding): string {
  const mac = isMacPlatform();
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (binding.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (binding.alt) parts.push(mac ? "⌥" : "Alt");
  if (binding.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push(displayKey(binding.key));
  return mac ? parts.join("") : parts.join("+");
}

export function formatShortcutForAria(binding: ShortcutBinding): string {
  const mac = isMacPlatform();
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "Meta" : "Control");
  if (binding.ctrl) parts.push("Control");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(displayKey(binding.key));
  return parts.join("+");
}

export function eventToBinding(event: KeyboardEvent): ShortcutBinding {
  return {
    key: normalizedKey(event.key),
    alt: event.altKey || undefined,
    shift: event.shiftKey || undefined,
    ctrl: event.ctrlKey || undefined,
    meta: event.metaKey || undefined,
  };
}

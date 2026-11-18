// Types of `ui/components.ts` (the implementation is compiled by the extension's UI build and
// stays out of this program: the UI kit's sources need the Svelte compiler to type-check).
// `test/ui-components.test.ts` keeps both files' export names equal.
import type { Component } from "svelte";

type Part = Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Parts<Names extends string> = Record<Names, Part>;
type ClassValue = string | false | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string;
export const Button: Part;
export function buttonVariants(options?: {
  variant?: string;
  size?: string;
  class?: string;
}): string;
export const Badge: Part;
export function badgeVariants(options?: {
  variant?: string;
  class?: string;
}): string;
export const Input: Part;
export const Textarea: Part;
export const Label: Part;
export const Checkbox: Part;
export const Switch: Part;
export const Skeleton: Part;
export const Spinner: Part;
export const Kbd: Part;
export const Separator: Part;
export const Progress: Part;
export const ScrollArea: Part;
export const Tabs: Parts<"Root" | "List" | "Trigger" | "Content">;
export const Select: Parts<"Root" | "Item" | "Content" | "Trigger" | "Portal">;
export const Tooltip: Parts<
  "Root" | "Trigger" | "Content" | "Provider" | "Portal"
>;
export const Collapsible: Parts<"Root" | "Content" | "Trigger">;
export const Empty: Parts<
  "Root" | "Header" | "Media" | "Title" | "Description" | "Content"
>;
export const RadioGroup: Parts<"Root" | "Item">;
export const ToggleGroup: Parts<"Root" | "Item">;
export const Resizable: Parts<"PaneGroup" | "Pane" | "Handle">;
export const Callout: Part;
export const GroupLabel: Part;
export const IconAction: Part;
export const SearchInput: Part;
export const StatusDot: Part;
export const ProgressRing: Part;
export const ScrollRegion: Part;

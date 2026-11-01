import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { createTV } from "tailwind-variants";

/**
 * Teach tailwind-merge the type roles from theme.css. Without this it reads
 * `text-ui` as a text colour, so `cn("text-ui", "text-foreground")` would drop
 * the font size. `tv` below shares the same config for component variants.
 */
const twMergeConfig = {
  override: { theme: { text: ["caption", "ui", "body", "title"] } },
};
const twMerge = extendTailwindMerge(twMergeConfig);

/** `tailwind-variants` with the type-role-aware merge; use instead of its `tv`. */
export const tv = createTV({ twMergeConfig });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shadcn-svelte component prop helper
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shadcn-svelte component prop helper
export type WithoutChildren<T> = T extends { children?: any }
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

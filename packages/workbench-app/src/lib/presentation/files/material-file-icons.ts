import { materialIconThemeData } from "virtual:material-icon-theme";
import { resolveMaterialFileIcon } from "./material-file-icon-resolver";

let spritePromise: Promise<void> | undefined;

export function ensureMaterialFileIconSprite(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const existing = document.getElementById("nerve-material-file-icons");
  if (existing) return Promise.resolve();
  spritePromise ??= fetch(materialIconThemeData.spriteUrl)
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Could not load file icons (${response.status}).`);
      const parsed = new DOMParser().parseFromString(
        await response.text(),
        "image/svg+xml",
      );
      const source = parsed.documentElement;
      if (source.localName !== "svg")
        throw new Error("Material file icon sprite is invalid.");
      const sprite = document.importNode(source, true);
      sprite.id = "nerve-material-file-icons";
      sprite.setAttribute("hidden", "");
      sprite.setAttribute("aria-hidden", "true");
      document.body.append(sprite);
    })
    .catch((error) => {
      spritePromise = undefined;
      throw error;
    });
  return spritePromise;
}

export function materialFileIcon(input: {
  name: string;
  kind: "file" | "directory" | "other";
  open?: boolean;
}): string {
  return resolveMaterialFileIcon(materialIconThemeData, input);
}

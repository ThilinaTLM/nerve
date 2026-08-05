export type MaterialFileIconData = {
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  urls: Record<string, string>;
};

const sortedExtensions = new WeakMap<MaterialFileIconData, readonly string[]>();

function extensionsFor(data: MaterialFileIconData): readonly string[] {
  let extensions = sortedExtensions.get(data);
  if (!extensions) {
    extensions = Object.keys(data.fileExtensions).sort(
      (left, right) => right.length - left.length,
    );
    sortedExtensions.set(data, extensions);
  }
  return extensions;
}

export function resolveMaterialFileIcon(
  data: MaterialFileIconData,
  input: { name: string; kind: "file" | "directory" | "other"; open?: boolean },
): string {
  const name = input.name.toLocaleLowerCase();
  let definition: string | undefined;
  if (input.kind === "directory") {
    definition = input.open
      ? data.folderNamesExpanded[name]
      : data.folderNames[name];
    definition ??= input.open ? data.folderExpanded : data.folder;
  } else {
    definition = data.fileNames[name];
    if (!definition) {
      const extension = extensionsFor(data).find((candidate) =>
        name.endsWith(`.${candidate}`),
      );
      if (extension) definition = data.fileExtensions[extension];
    }
    definition ??= data.file;
  }
  return data.urls[definition] ?? data.urls[data.file] ?? "";
}

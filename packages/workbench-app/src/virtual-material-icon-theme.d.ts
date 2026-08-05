declare module "virtual:material-icon-theme" {
  export type MaterialIconThemeData = {
    spriteUrl: string;
    file: string;
    folder: string;
    folderExpanded: string;
    fileNames: Record<string, string>;
    fileExtensions: Record<string, string>;
    folderNames: Record<string, string>;
    folderNamesExpanded: Record<string, string>;
    urls: Record<string, string>;
  };

  export const materialIconThemeData: MaterialIconThemeData;
}

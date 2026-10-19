/** Launch metadata only: never include submitted commands, argv, or environment values. */
export type ProjectShellLaunchContext = {
  cwd: string;
  executable: string;
  shell: string;
  manager?: "direnv" | "mise" | "fnm" | "nvm";
  configFile?: string;
};

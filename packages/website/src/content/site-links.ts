export interface LinkColumn {
  title: string;
  links: Array<{ label: string; href: string }>;
}

const links = {
  home: { label: "Home", href: "/" },
  overview: { label: "Overview", href: "/start/overview/" },
  install: { label: "Install", href: "/start/install/" },
  firstProject: { label: "First project", href: "/start/first-project/" },
  firstTask: { label: "First task", href: "/start/first-task/" },
  workbench: { label: "Workbench", href: "/guides/workbench/" },
  conversations: { label: "Conversations", href: "/guides/conversations/" },
  providers: {
    label: "Models & providers",
    href: "/models/providers-and-auth/",
  },
  troubleshooting: { label: "Troubleshooting", href: "/troubleshooting/" },
  security: { label: "Security model", href: "/operations/security/" },
  configuration: {
    label: "Configuration",
    href: "/operations/configuration/",
  },
  architecture: { label: "Architecture", href: "/developers/architecture/" },
  protocol: { label: "Protocol v1", href: "/developers/protocol/v1/" },
  extensions: { label: "Extensions", href: "/developers/extensions/" },
  contributing: { label: "Contributing", href: "/developers/contributing/" },
  github: { label: "GitHub", href: "https://github.com/ThilinaTLM/nerve" },
  license: {
    label: "License",
    href: "https://github.com/ThilinaTLM/nerve/blob/main/LICENSE",
  },
  securityPolicy: {
    label: "Security policy",
    href: "https://github.com/ThilinaTLM/nerve/blob/main/SECURITY.md",
  },
} as const;

export const marketingFooterColumns: LinkColumn[] = [
  {
    title: "Product",
    links: [links.overview, links.install, links.firstProject, links.firstTask],
  },
  {
    title: "Documentation",
    links: [
      links.workbench,
      links.conversations,
      links.providers,
      links.troubleshooting,
    ],
  },
  {
    title: "Developers",
    links: [
      links.architecture,
      links.protocol,
      links.extensions,
      links.contributing,
    ],
  },
  {
    title: "Project",
    links: [links.github, links.license, links.securityPolicy, links.security],
  },
];

export const docsFooterColumns: LinkColumn[] = [
  {
    title: "Start",
    links: [links.overview, links.install, links.firstTask],
  },
  {
    title: "Operate",
    links: [links.security, links.configuration, links.troubleshooting],
  },
  {
    title: "Build",
    links: [links.architecture, links.protocol, links.contributing],
  },
  {
    title: "Project",
    links: [links.home, links.github, links.license],
  },
];

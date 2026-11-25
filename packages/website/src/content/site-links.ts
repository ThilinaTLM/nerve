export interface LinkColumn {
  title: string;
  links: Array<{ label: string; href: string }>;
}

const links = {
  home: { label: "Home", href: "/" },
  getStarted: { label: "Get started", href: "/start/" },
  overview: { label: "Overview", href: "/start/overview/" },
  install: { label: "Install", href: "/start/install/" },
  firstTask: { label: "First task", href: "/start/first-task/" },
  workbench: { label: "Workbench", href: "/guides/workbench/" },
  configureByChat: {
    label: "Configure by chat",
    href: "/guides/configure-by-chat/",
  },
  buildExtensions: {
    label: "Build extensions",
    href: "/guides/build-extensions/",
  },
  jira: { label: "Jira", href: "/integrations/jira/" },
  mcp: { label: "MCP servers", href: "/integrations/mcp/" },
  phone: { label: "Phone and remote", href: "/operations/lan-mobile/" },
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
    links: [
      links.getStarted,
      links.install,
      links.configureByChat,
      links.phone,
    ],
  },
  {
    title: "Documentation",
    links: [links.workbench, links.jira, links.mcp, links.providers],
  },
  {
    title: "Developers",
    links: [
      links.buildExtensions,
      links.architecture,
      links.protocol,
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
    links: [links.getStarted, links.overview, links.firstTask],
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

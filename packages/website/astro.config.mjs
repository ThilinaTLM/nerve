import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { redirects } from "./redirects.mjs";

export default defineConfig({
  site: "https://nerve.tlmtech.dev",
  output: "static",
  redirects,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap(),
    starlight({
      title: "Nerve",
      description:
        "Nerve is a transparent, local-first desktop coding harness with a complete project workbench.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/app.css"],
      components: {
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        Footer: "./src/components/starlight/Footer.astro",
        Hero: "./src/components/starlight/Hero.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
      },
      expressiveCode: {
        emitExternalStylesheet: false,
        themes: ["github-dark-default", "github-light"],
        useStarlightDarkModeSwitch: true,
        useStarlightUiThemeColors: true,
        styleOverrides: {
          borderRadius: "0.75rem",
          codeFontFamily: "var(--font-mono)",
        },
      },
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            sizes: "32x32",
            href: "/favicon-32.png",
          },
        },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            media: "(prefers-color-scheme: dark)",
            content: "#292724",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            media: "(prefers-color-scheme: light)",
            content: "#faf9f5",
          },
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/ThilinaTLM/nerve/edit/main/packages/website/",
      },
      lastUpdated: true,
      disable404Route: true,
      social: [
        {
          icon: "github",
          label: "Nerve on GitHub",
          href: "https://github.com/ThilinaTLM/nerve",
        },
      ],
      sidebar: [
        { label: "Home", link: "/" },
        {
          label: "Get started",
          items: [
            { label: "Get started", slug: "start" },
            { label: "What is Nerve?", slug: "start/overview" },
            { label: "Install", slug: "start/install" },
            { label: "Connect a model", slug: "start/providers" },
            { label: "Open a project", slug: "start/first-project" },
            { label: "Your first task", slug: "start/first-task" },
            {
              label: "Discover and in-app guides",
              slug: "start/learn-in-app",
            },
          ],
        },
        {
          label: "Everyday work",
          items: [
            { label: "Workflow overview", slug: "guides" },
            { label: "Find your way around", slug: "guides/workbench" },
            { label: "Write prompts", slug: "guides/composer" },
            { label: "Images and voice", slug: "guides/images-and-voice" },
            {
              label: "Choose a profile, model, and permissions",
              slug: "guides/agent-controls",
            },
            {
              label: "Approvals, questions, and plans",
              slug: "guides/reviews",
            },
            {
              label: "Find and organize conversations",
              slug: "guides/conversations",
            },
            {
              label: "History, branches, and recovery",
              slug: "guides/history-and-recovery",
            },
            {
              label: "Notifications and activity",
              slug: "guides/notifications",
            },
            {
              label: "Files, context, and notes",
              slug: "guides/files-context-notes",
            },
          ],
        },
        {
          label: "Review and ship",
          items: [
            { label: "Git changes", slug: "guides/git" },
            { label: "Pull requests", slug: "guides/pull-requests" },
            {
              label: "External editors",
              slug: "integrations/external-editors",
            },
          ],
        },
        {
          label: "Delegate and automate",
          items: [
            {
              label: "Sub-agents",
              slug: "guides/agents-and-delegation",
            },
            {
              label: "Launches and background commands",
              slug: "guides/background-tasks",
            },
            {
              label: "Prompt suggestions",
              slug: "guides/prompt-suggestions",
            },
            {
              label: "Skills and project resources",
              slug: "guides/skills-and-resources",
            },
          ],
        },
        {
          label: "Customize",
          items: [
            { label: "Themes and appearance", slug: "guides/personalize" },
            { label: "Settings at a glance", slug: "guides/settings" },
            { label: "Keyboard shortcuts", slug: "reference/shortcuts" },
          ],
        },
        {
          label: "Models and integrations",
          items: [
            {
              label: "Models",
              items: [{ autogenerate: { directory: "models" } }],
            },
            {
              label: "Integrations",
              items: [{ autogenerate: { directory: "integrations" } }],
            },
          ],
        },
        {
          label: "Set up and operate",
          items: [{ autogenerate: { directory: "operations" } }],
        },
        {
          label: "Troubleshooting",
          items: [{ autogenerate: { directory: "troubleshooting" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
        {
          label: "Developers",
          collapsed: true,
          items: [{ autogenerate: { directory: "developers" } }],
        },
      ],
    }),
  ],
});

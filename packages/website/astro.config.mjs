import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://nerve.tlmtech.dev",
  output: "static",
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
          label: "Start here",
          items: [{ autogenerate: { directory: "start" } }],
        },
        {
          label: "Use Nerve",
          items: [
            { label: "Workflow overview", link: "/guides/" },
            {
              label: "Everyday work",
              items: [
                { label: "Navigate the workbench", link: "/guides/workbench/" },
                { label: "Use the composer", link: "/guides/composer/" },
                {
                  label: "Add images and voice",
                  link: "/guides/images-and-voice/",
                },
                { label: "Control the agent", link: "/guides/agent-controls/" },
                {
                  label: "Review approvals, questions, and plans",
                  link: "/guides/reviews/",
                },
                {
                  label: "Organize conversations",
                  link: "/guides/conversations/",
                },
                {
                  label: "Use history, branches, and recovery",
                  link: "/guides/history-and-recovery/",
                },
                {
                  label: "Edit files, inspect context, and keep notes",
                  link: "/guides/files-context-notes/",
                },
                {
                  label: "Work with Git and pull requests",
                  link: "/guides/git-and-pull-requests/",
                },
              ],
            },
            {
              label: "Delegate and automate",
              items: [
                {
                  label: "Work with agents and delegation",
                  link: "/guides/agents-and-delegation/",
                },
                {
                  label: "Run background tasks",
                  link: "/guides/background-tasks/",
                },
                {
                  label: "Use prompt suggestions",
                  link: "/guides/prompt-suggestions/",
                },
                {
                  label: "Load skills and project resources",
                  link: "/guides/skills-and-resources/",
                },
              ],
            },
            {
              label: "Customize and move work",
              items: [
                { label: "Personalize Nerve", link: "/guides/personalize/" },
                { label: "Configure Settings", link: "/guides/settings/" },
                {
                  label: "Import, export, and open editors",
                  link: "/guides/import-export-editors/",
                },
              ],
            },
          ],
        },
        {
          label: "Models & integrations",
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
          label: "Operate safely",
          items: [{ autogenerate: { directory: "operations" } }],
        },
        {
          label: "Troubleshooting",
          items: [{ autogenerate: { directory: "troubleshooting" } }],
        },
        {
          label: "Developers",
          items: [{ autogenerate: { directory: "developers" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});

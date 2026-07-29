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
        themes: ["github-dark-default", "github-light"],
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
          "https://github.com/ThilinaTLM/nerve/edit/main/packages/website/src/content/docs/",
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
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Models",
          items: [{ autogenerate: { directory: "models" } }],
        },
        {
          label: "Integrations",
          items: [{ autogenerate: { directory: "integrations" } }],
        },
        {
          label: "Advanced operation",
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

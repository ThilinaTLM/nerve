import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://nerve.tlmtech.dev",
  output: "static",
  integrations: [
    sitemap(),
    starlight({
      title: "Nerve",
      description:
        "Nerve is a transparent, local-first desktop coding harness with a complete project workbench.",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/nerve-mark.svg",
        alt: "Nerve",
      },
      customCss: ["./src/styles/site.css"],
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

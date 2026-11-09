import { lazyApi } from "@earendil-works/pi-ai";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";

// pi-ai loads its OAuth flows and the Bedrock implementation through variable
// import specifiers relative to its own files, which bundlers cannot follow.
// Those files do not exist in the flat bundled desktop dist/, so every OAuth
// login/token use and Bedrock request would fail there. Registering the flows
// statically and pointing Bedrock at a literal (bundler-visible) import keeps
// both working bundled and unbundled. Registration is process-global, so it
// also covers the server's own pi-ai model registry.
registerBunOAuthFlows();
setBedrockProviderModule(
  lazyApi(
    async () =>
      (await import("@earendil-works/pi-ai/bedrock-provider"))
        .bedrockProviderModule,
  ),
);

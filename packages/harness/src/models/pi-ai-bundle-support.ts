import { registerLazyBedrockProvider } from "@earendil-works/pi-ai/lazy-bedrock-provider";
import { registerLazyOAuthFlows } from "@earendil-works/pi-ai/lazy-oauth";

// By default pi-ai imports its OAuth flows and the Bedrock implementation
// through variable specifiers relative to its own files, which bundlers cannot
// follow and which do not exist in the flat bundled desktop dist/. These
// helpers register literal dynamic imports instead, so the code splitting desktop
// bundle keeps each flow and Bedrock (with the AWS SDK) as lazy chunks. They
// also work unbundled. Registration is process-global, so it also covers the
// server's own pi-ai model registry. Node-only: never import from browser code.
registerLazyOAuthFlows();
registerLazyBedrockProvider();

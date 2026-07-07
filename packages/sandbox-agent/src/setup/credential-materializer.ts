import path from "node:path";
import type { SandboxCredentialConfig } from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { atomicWriteFile } from "../state/json-store.js";
export async function materializeCredentialFile(
  credentialsDir: string,
  name: string,
  credential: SandboxCredentialConfig,
  resolver: SecretResolver,
): Promise<string> {
  const filePath = path.join(
    credentialsDir,
    `${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}.secret`,
  );
  let value = "";
  if (credential.type === "api_key")
    value = await resolver.resolve(credential.apiKey);
  else if (credential.type === "bearer")
    value = await resolver.resolve(credential.token);
  else if (credential.type === "ssh")
    value = await resolver.resolve(credential.privateKey);
  else if (credential.type === "gpg")
    value = await resolver.resolve(credential.privateKey);
  else if (credential.type === "basic")
    value = await resolver.resolve(credential.password);
  await atomicWriteFile(filePath, value, 0o600);
  return filePath;
}

export type SandboxHealthcheckResult = {
  ok: true;
  component: "nerve-sandbox";
  scaffold: true;
};

export function sandboxHealthcheck(): SandboxHealthcheckResult {
  return { ok: true, component: "nerve-sandbox", scaffold: true };
}

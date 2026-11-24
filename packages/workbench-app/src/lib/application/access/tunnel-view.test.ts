import assert from "node:assert/strict";
import test from "node:test";
import {
  describeTunnel,
  describeTunnelProblem,
  tunnelPhoneSummary,
} from "./tunnel-view";

test("maps each tunnel state", () => {
  assert.equal(describeTunnel({ state: "off" }).summary, "Off");
  const ready = describeTunnel({ state: "ready", url: "https://a.ts.net/" });
  assert.equal(ready.tone, "success");
  assert.equal(ready.url, "https://a.ts.net/");
  assert.match(
    describeTunnel({ state: "certificate", url: "https://a.ts.net/" }).detail ??
      "",
    /a minute/,
  );
});

test("maps problems to one action", () => {
  assert.equal(
    describeTunnelProblem({ code: "not_installed" }).link?.href,
    "https://tailscale.com/download",
  );
  assert.equal(
    describeTunnelProblem({ code: "serve_not_enabled" }).link?.href,
    "https://login.tailscale.com/admin/dns",
  );
  assert.equal(
    describeTunnelProblem({
      code: "serve_not_enabled",
      approvalUrl: "https://login.tailscale.com/f/serve?node=1",
    }).link?.href,
    "https://login.tailscale.com/f/serve?node=1",
  );
  assert.equal(
    describeTunnelProblem({ code: "permission_denied" }).command,
    "sudo tailscale set --operator=$USER",
  );
  const inUse = describeTunnelProblem({ code: "port_in_use", httpsPort: 8443 });
  assert.match(inUse.summary, /port 8443/);
  assert.equal(inUse.retry, false);
  assert.equal(
    describeTunnelProblem({ code: "funnel_enabled", httpsPort: 443 }).command,
    "tailscale funnel --https=443 off",
  );
  assert.equal(
    describeTunnelProblem({ code: "command_failed", detail: "boom" }).detail,
    "boom",
  );
});

test("summarizes for the phone", () => {
  assert.equal(
    tunnelPhoneSummary({ state: "ready", url: "https://a.ts.net:8443/" }),
    "Private access on · a.ts.net:8443",
  );
  assert.match(tunnelPhoneSummary(undefined), /^Off/);
  assert.match(
    tunnelPhoneSummary({ state: "problem", problem: { code: "not_running" } }),
    /^Problem/,
  );
});

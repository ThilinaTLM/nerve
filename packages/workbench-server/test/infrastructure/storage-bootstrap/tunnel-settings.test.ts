import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, describe, it } from "node:test";
import {
  initializeStorage,
  writeSettings,
  writeTunnelListenerPort,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { tempHome } from "../../helpers/server-routes.js";

const homes: string[] = [];
after(() =>
  Promise.all(homes.map((home) => rm(home, { recursive: true, force: true }))),
);

describe("tunnel settings", () => {
  it("keeps the listener port when the tunnel is patched, and the patch cannot set it", async () => {
    const home = await tempHome("nerve-tunnel-settings-");
    homes.push(home);
    const storage = await initializeStorage(home);
    await writeTunnelListenerPort(storage, 5000);
    await writeSettings(storage, {
      application: { network: { tunnel: { enabled: true, httpsPort: 8443 } } },
    });
    assert.deepEqual(storage.settings.application.network.tunnel, {
      enabled: true,
      httpsPort: 8443,
      listenerPort: 5000,
    });
    await writeSettings(storage, {
      application: {
        network: { tunnel: { enabled: false, listenerPort: 6000 } },
      } as never,
    });
    assert.deepEqual(storage.settings.application.network.tunnel, {
      enabled: false,
      httpsPort: 8443,
      listenerPort: 5000,
    });
  });
});

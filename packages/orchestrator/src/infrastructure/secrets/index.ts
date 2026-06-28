import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "../storage/index.js";

export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export class EncryptedFileSecretProvider implements SecretProvider {
  constructor(private readonly dataDir: string) {}

  async get(name: string): Promise<string | undefined> {
    const values = await this.readAll();
    return values[name];
  }

  async set(name: string, value: string): Promise<void> {
    const values = await this.readAll();
    values[name] = value;
    await this.writeAll(values);
  }

  async delete(name: string): Promise<void> {
    const values = await this.readAll();
    delete values[name];
    await this.writeAll(values);
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.readAll()).sort();
  }

  private keyPath(): string {
    return join(this.dataDir, "keys", "master.key");
  }

  private storePath(): string {
    return join(this.dataDir, "keys", "secrets.json.enc");
  }

  private async loadKey(): Promise<Buffer> {
    const path = this.keyPath();
    if (!(await pathExists(path))) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const key = randomBytes(32);
      await writeFile(path, key.toString("base64"), { mode: 0o600 });
      await chmod(path, 0o600).catch(() => undefined);
      return key;
    }
    return Buffer.from((await readFile(path, "utf8")).trim(), "base64");
  }

  private async readAll(): Promise<Record<string, string>> {
    const path = this.storePath();
    if (!(await pathExists(path))) return {};
    const key = await this.loadKey();
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(raw.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(raw.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as Record<string, string>;
  }

  private async writeAll(values: Record<string, string>): Promise<void> {
    const key = await this.loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(values), "utf8"),
      cipher.final(),
    ]);
    const payload = JSON.stringify(
      {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: encrypted.toString("base64"),
      },
      null,
      2,
    );
    const path = this.storePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${payload}\n`, { mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
  }
}

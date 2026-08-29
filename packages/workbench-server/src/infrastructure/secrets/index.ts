import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../storage-bootstrap/file-mutations.js";
import { pathExists } from "../storage-bootstrap/json.js";
import { storagePaths } from "../storage-bootstrap/paths.js";

export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

type EncryptedCredentialEnvelope = {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  tag: string;
  data: string;
};

export class EncryptedFileSecretProvider implements SecretProvider {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly home: string) {}

  async initialize(): Promise<void> {
    await this.loadKey();
    if (!(await pathExists(this.storePath()))) await this.writeAll({});
    await chmod(this.storePath(), 0o600).catch(() => undefined);
  }

  async validate(): Promise<void> {
    if (
      !(await pathExists(this.keyPath())) ||
      !(await pathExists(this.storePath()))
    ) {
      throw new Error("Nerve encrypted credential storage is incomplete.");
    }
    await this.readAll();
  }

  async get(name: string): Promise<string | undefined> {
    return (await this.readAll())[name];
  }

  set(name: string, value: string): Promise<void> {
    return this.serialized(async () => {
      const values = await this.readAll();
      values[name] = value;
      await this.writeAll(values);
    });
  }

  delete(name: string): Promise<void> {
    return this.serialized(async () => {
      const values = await this.readAll();
      delete values[name];
      await this.writeAll(values);
    });
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.readAll()).sort();
  }

  private keyPath(): string {
    return storagePaths(this.home).masterKeyPath;
  }

  private storePath(): string {
    return storagePaths(this.home).credentialsPath;
  }

  private async loadKey(): Promise<Buffer> {
    const path = this.keyPath();
    if (!(await pathExists(path))) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const key = randomBytes(32);
      await atomicWriteFile(path, key.toString("base64"), { mode: 0o600 });
      await chmod(path, 0o600).catch(() => undefined);
      return key;
    }
    const key = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
    if (key.byteLength !== 32) throw new Error("Invalid Nerve master key.");
    return key;
  }

  private async readAll(): Promise<Record<string, string>> {
    const path = this.storePath();
    if (!(await pathExists(path))) return {};
    const raw = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<EncryptedCredentialEnvelope>;
    if (
      raw.version !== 1 ||
      raw.algorithm !== "A256GCM" ||
      typeof raw.iv !== "string" ||
      typeof raw.tag !== "string" ||
      typeof raw.data !== "string"
    ) {
      throw new Error("Invalid encrypted credential envelope.");
    }
    const key = await this.loadKey();
    const iv = Buffer.from(raw.iv, "base64");
    const tag = Buffer.from(raw.tag, "base64");
    if (iv.byteLength !== 12 || tag.byteLength !== 16) {
      throw new Error("Invalid encrypted credential nonce or tag.");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(raw.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid encrypted credential payload.");
    }
    for (const value of Object.values(parsed)) {
      if (typeof value !== "string") {
        throw new Error("Invalid encrypted credential value.");
      }
    }
    return parsed as Record<string, string>;
  }

  private async writeAll(values: Record<string, string>): Promise<void> {
    const key = await this.loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ordered = Object.fromEntries(
      Object.entries(values).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(ordered), "utf8"),
      cipher.final(),
    ]);
    const payload: EncryptedCredentialEnvelope = {
      version: 1,
      algorithm: "A256GCM",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    };
    const path = this.storePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await atomicWriteFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(path, 0o600).catch(() => undefined);
  }

  private serialized(operation: () => Promise<void>): Promise<void> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.catch(() => undefined);
    return result;
  }
}

import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AuthorityKeyIdentifierExtension,
  BasicConstraintsExtension,
  DNS,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  IP,
  type JsonGeneralNames,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509Certificate,
  X509CertificateGenerator,
} from "@peculiar/x509";

const RSA_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;

const CA_COMMON_NAME = "Nerve Local Development CA";
const SERVER_COMMON_NAME = "Nerve LAN HTTPS";
const ROOT_CA_VALID_DAYS = 3650;
const SERVER_CERT_VALID_DAYS = 825;
const RENEW_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface MobileHttpsTlsMaterial {
  keyPem: string;
  certPem: string;
  caCertPem: string;
  hosts: string[];
  primaryHost: string;
}

interface LoadedCa {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  cert: X509Certificate;
  certPem: string;
}

export async function ensureMobileHttpsTlsMaterial(
  dataDir: string,
  hosts: string[],
): Promise<MobileHttpsTlsMaterial> {
  const normalizedHosts = normalizeHosts(hosts);
  const tlsDir = join(dataDir, "tls");
  await mkdir(tlsDir, { recursive: true, mode: 0o700 });
  await chmod(tlsDir, 0o700).catch(() => undefined);

  const ca = await ensureRootCa(tlsDir);
  const server = await createServerCertificate(ca, normalizedHosts);
  await writePrivateFile(join(tlsDir, "lan-server-key.pem"), server.keyPem);
  await writePublicFile(join(tlsDir, "lan-server-cert.pem"), server.certPem);
  await writePublicFile(join(tlsDir, "nerve-local-ca.pem"), ca.certPem);

  return {
    keyPem: server.keyPem,
    certPem: server.certPem,
    caCertPem: ca.certPem,
    hosts: normalizedHosts,
    primaryHost: normalizedHosts[0] ?? "localhost",
  };
}

export function normalizeHosts(hosts: string[]): string[] {
  const normalized = new Set<string>();
  for (const host of hosts) {
    const trimmed = host.trim();
    if (trimmed) normalized.add(trimmed);
  }
  normalized.add("localhost");
  normalized.add("127.0.0.1");
  return [...normalized];
}

async function ensureRootCa(tlsDir: string): Promise<LoadedCa> {
  const keyPath = join(tlsDir, "nerve-local-ca-key.pem");
  const certPath = join(tlsDir, "nerve-local-ca.pem");
  const loaded = await loadRootCa(keyPath, certPath);
  if (loaded && !expiresSoon(loaded.cert.notAfter)) return loaded;

  const keys = await generateRsaKeyPair();
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerialNumber(),
    name: `CN=${CA_COMMON_NAME}`,
    notBefore: dateDaysFromNow(-1),
    notAfter: dateDaysFromNow(ROOT_CA_VALID_DAYS),
    signingAlgorithm: RSA_ALGORITHM,
    keys,
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
        true,
      ),
      await SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const privateKeyPem = await exportPrivateKeyPem(keys.privateKey);
  const publicKeyPem = await exportPublicKeyPem(keys.publicKey);
  const certPem = cert.toString("pem");

  await writePrivateFile(keyPath, privateKeyPem);
  await writePublicFile(
    join(tlsDir, "nerve-local-ca-public-key.pem"),
    publicKeyPem,
  );
  await writePublicFile(certPath, certPem);

  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    cert,
    certPem,
  };
}

async function loadRootCa(
  keyPath: string,
  certPath: string,
): Promise<LoadedCa | undefined> {
  try {
    const [privateKeyPem, certPem] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(certPath, "utf8"),
    ]);
    const cert = new X509Certificate(certPem);
    const privateKey = await importPrivateKeyPem(privateKeyPem);
    const publicKey = await cert.publicKey.export();
    return { privateKey, publicKey, cert, certPem };
  } catch {
    return undefined;
  }
}

async function createServerCertificate(
  ca: LoadedCa,
  hosts: string[],
): Promise<{ keyPem: string; certPem: string }> {
  const keys = await generateRsaKeyPair();
  const cert = await X509CertificateGenerator.create({
    serialNumber: randomSerialNumber(),
    subject: `CN=${SERVER_COMMON_NAME}`,
    issuer: ca.cert.subject,
    notBefore: dateDaysFromNow(-1),
    notAfter: dateDaysFromNow(SERVER_CERT_VALID_DAYS),
    signingAlgorithm: RSA_ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: ca.privateKey,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(
        KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
        true,
      ),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
      new SubjectAlternativeNameExtension(
        subjectAlternativeNames(hosts),
        false,
      ),
      await SubjectKeyIdentifierExtension.create(keys.publicKey),
      await AuthorityKeyIdentifierExtension.create(ca.publicKey),
    ],
  });
  return {
    keyPem: await exportPrivateKeyPem(keys.privateKey),
    certPem: cert.toString("pem"),
  };
}

function subjectAlternativeNames(hosts: string[]): JsonGeneralNames {
  return hosts.map((host) =>
    isIpv4Address(host)
      ? { type: IP, value: host }
      : { type: DNS, value: host },
  );
}

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(RSA_ALGORITHM, true, ["sign", "verify"]);
}

async function exportPrivateKeyPem(privateKey: CryptoKey): Promise<string> {
  return pemBlock(
    "PRIVATE KEY",
    Buffer.from(await crypto.subtle.exportKey("pkcs8", privateKey)),
  );
}

async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  return pemBlock(
    "PUBLIC KEY",
    Buffer.from(await crypto.subtle.exportKey("spki", publicKey)),
  );
}

async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem, "PRIVATE KEY"),
    RSA_ALGORITHM,
    true,
    ["sign"],
  );
}

function pemBlock(label: string, der: Buffer): string {
  const base64 = der
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trim();
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/g, "");
  const bytes = Buffer.from(body, "base64");
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function randomSerialNumber(): string {
  return randomBytes(16).toString("hex");
}

function dateDaysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function expiresSoon(notAfter: Date): boolean {
  return notAfter.getTime() - Date.now() < RENEW_WITHIN_MS;
}

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    })
  );
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function writePublicFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o644 });
  await chmod(path, 0o644).catch(() => undefined);
}

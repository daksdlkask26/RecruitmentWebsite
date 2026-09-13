import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { serverEnvironment } from "@/backend/env/runtime";

const key = createHmac("sha256", serverEnvironment.TOKEN_SECRET)
  .update("smarthire-token-protector-v1")
  .digest();

export class TokenProtector {
  generate(): string {
    return randomBytes(32).toString("base64url");
  }
  digest(token: string): string {
    return createHmac("sha256", key).update(token).digest("hex");
  }
  matches(token: string, digest: string): boolean {
    const actual = Buffer.from(this.digest(token), "hex");
    const expected = Buffer.from(digest, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  seal(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }
  unseal(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 4) throw new Error("INVALID_PROTECTED_TOKEN");
    const [version, iv, tag, ciphertext] = parts;
    if (version !== "v1" || !iv || !tag || !ciphertext)
      throw new Error("INVALID_PROTECTED_TOKEN");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

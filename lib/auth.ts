import crypto from "crypto";

// Usa o CRON_SECRET já existente como chave de assinatura (evita pedir mais uma variável)
const SECRET = process.env.CRON_SECRET || "troque-isso";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function createSessionToken(): string {
  const expires = Date.now() + MAX_AGE_MS;
  const sig = crypto.createHmac("sha256", SECRET).update(String(expires)).digest("hex");
  return `${expires}.${sig}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresStr, sig] = token.split(".");
  if (!expiresStr || !sig) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(expiresStr).digest("hex");
  if (sig.length !== expected.length) return false;
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return false;
  return Date.now() < Number(expiresStr);
}

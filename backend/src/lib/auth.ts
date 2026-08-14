import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { env } from "./env";
import { HttpError } from "./http";

const COOKIE_NAME = "session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload {
  sub: string; // userId
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: SESSION_MAX_AGE_SECONDS });
}

// Local dev runs the API over plain HTTP, where a `Secure` cookie is silently
// dropped by the browser. LOCAL_DEV relaxes Secure/SameSite for that case only;
// production (behind API Gateway HTTPS) always gets Secure + SameSite=None,
// which is required because the frontend and API live on different origins.
const isLocalDev = process.env.LOCAL_DEV === "1";

export function buildSessionCookie(token: string): string {
  const attrs = [`${COOKIE_NAME}=${token}`, "HttpOnly", "Path=/", `Max-Age=${SESSION_MAX_AGE_SECONDS}`];
  attrs.push(isLocalDev ? "SameSite=Lax" : "SameSite=None; Secure");
  return attrs.join("; ");
}

export function buildClearCookie(): string {
  const attrs = [`${COOKIE_NAME}=`, "HttpOnly", "Path=/", "Max-Age=0"];
  attrs.push(isLocalDev ? "SameSite=Lax" : "SameSite=None; Secure");
  return attrs.join("; ");
}

function readCookie(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const cookies = event.cookies ?? [];
  for (const c of cookies) {
    const idx = c.indexOf("=");
    if (idx === -1) continue;
    if (c.slice(0, idx).trim() === name) return c.slice(idx + 1).trim();
  }
  return undefined;
}

export function requireSession(event: APIGatewayProxyEventV2): SessionPayload {
  const token = readCookie(event, COOKIE_NAME);
  if (!token) throw new HttpError(401, "No autenticado");
  try {
    return jwt.verify(token, env.jwtSecret) as SessionPayload;
  } catch {
    throw new HttpError(401, "Sesión inválida o expirada");
  }
}

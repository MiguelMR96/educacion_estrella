import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { createUser, getUserByEmail } from "../lib/db";
import { registerSchema, loginSchema } from "../lib/validation";
import {
  buildClearCookie,
  buildSessionCookie,
  comparePassword,
  hashPassword,
  requireSession,
  signSession,
} from "../lib/auth";
import { errorResponse, HttpError, json } from "../lib/http";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;

    // `await` here (not just `return fn(event)`) matters: without it, a
    // rejection thrown after the function's first `await` happens outside
    // this try block's synchronous execution, so `catch` never sees it — it
    // surfaces as an unhandled Lambda error (API Gateway 500) instead of the
    // clean 4xx JSON response HttpError is meant to produce.
    if (method === "POST" && path.endsWith("/auth/register")) return await register(event);
    if (method === "POST" && path.endsWith("/auth/login")) return await login(event);
    if (method === "POST" && path.endsWith("/auth/logout")) return logout();
    if (method === "GET" && path.endsWith("/auth/me")) return me(event);

    return json(404, { error: "Not found" });
  } catch (err) {
    return errorResponse(err);
  }
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

async function register(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = registerSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new HttpError(400, "Datos de registro inválidos", parsed.error.flatten());
  }
  const { email, password } = parsed.data;

  const existing = await getUserByEmail(email);
  if (existing) throw new HttpError(409, "Ya existe una cuenta con ese correo");

  const userId = uuidv4();
  const passwordHash = await hashPassword(password);
  await createUser({ email, userId, passwordHash, createdAt: new Date().toISOString() });

  const token = signSession({ sub: userId, email });
  return json(201, { userId, email }, { cookies: [buildSessionCookie(token)] });
}

async function login(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = loginSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new HttpError(400, "Datos de inicio de sesión inválidos", parsed.error.flatten());
  }
  const { email, password } = parsed.data;

  const user = await getUserByEmail(email);
  if (!user) throw new HttpError(401, "Correo o contraseña incorrectos");

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw new HttpError(401, "Correo o contraseña incorrectos");

  const token = signSession({ sub: user.userId, email: user.email });
  return json(200, { userId: user.userId, email: user.email }, {
    cookies: [buildSessionCookie(token)],
  });
}

function logout(): APIGatewayProxyResultV2 {
  return json(200, { ok: true }, { cookies: [buildClearCookie()] });
}

function me(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  const session = requireSession(event);
  return json(200, { userId: session.sub, email: session.email });
}

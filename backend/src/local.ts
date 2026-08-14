// Local dev server: adapts plain HTTP requests into the API Gateway HTTP API
// (v2) event shape so the exact same Lambda handlers run locally and in AWS.
// Requires AWS credentials in the environment (e.g. `aws configure`) since it
// still talks to real DynamoDB tables / S3 bucket — see README for setup.
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler as authHandler } from "./handlers/auth";
import { handler as applicationsHandler } from "./handlers/applications";

process.env.LOCAL_DEV = "1";

// Fail fast with one clear message instead of crashing mid-request the first
// time a handler touches a missing var (which is what used to happen).
const REQUIRED_VARS = ["USERS_TABLE", "APPLICATIONS_TABLE", "VIDEOS_BUCKET", "JWT_SECRET"];
const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Faltan variables de entorno: ${missing.join(", ")}`);
  console.error("Copia backend/.env.example a backend/.env y complétalo con los nombres reales");
  console.error("(los ves en la salida de `cdk deploy` o en la consola de Lambda > Configuration > Environment variables).");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", corsOrigin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function toEvent(req: express.Request): APIGatewayProxyEventV2 {
  const cookies = Object.entries(req.cookies ?? {}).map(([k, v]) => `${k}=${v}`);
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: req.path,
    rawQueryString: "",
    cookies,
    headers: req.headers as Record<string, string>,
    requestContext: {
      http: { method: req.method, path: req.path },
    } as APIGatewayProxyEventV2["requestContext"],
    body: req.body ? JSON.stringify(req.body) : undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function run(
  lambdaHandler: typeof authHandler,
  req: express.Request,
  res: express.Response
) {
  const result = await lambdaHandler(toEvent(req));
  const r = result as { statusCode: number; body: string; cookies?: string[] };
  for (const cookie of r.cookies ?? []) res.append("Set-Cookie", cookie);
  res.status(r.statusCode).type("application/json").send(r.body);
}

app.all("/auth/*", (req, res) => void run(authHandler, req, res));
app.all("/applications", (req, res) => void run(applicationsHandler, req, res));
app.all("/applications/*", (req, res) => void run(applicationsHandler, req, res));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API local escuchando en http://localhost:${port}`));

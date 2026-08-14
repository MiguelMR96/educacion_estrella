import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { env } from "./env";

export function json(
  statusCode: number,
  body: unknown,
  opts: { cookies?: string[] } = {}
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": env.corsOrigin,
      "Access-Control-Allow-Credentials": "true",
    },
    cookies: opts.cookies,
    body: JSON.stringify(body),
  };
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function errorResponse(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof HttpError) {
    return json(err.statusCode, { error: err.message, details: err.details });
  }
  console.error("Unhandled error", err);
  return json(500, { error: "Internal server error" });
}

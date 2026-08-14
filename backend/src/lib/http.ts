import type { APIGatewayProxyResultV2 } from "aws-lambda";

// CORS headers are NOT set here: API Gateway's HTTP API CORS config (see the
// CDK stack) already decorates every response, and the local Express server
// (local.ts) sets them itself. Setting them a third time here would require
// CORS_ORIGIN even on error responses (it used to, and crashed local dev when
// that var wasn't set) and risks conflicting/duplicate headers in prod.
export function json(
  statusCode: number,
  body: unknown,
  opts: { cookies?: string[] } = {}
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
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

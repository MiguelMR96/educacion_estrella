import { beforeAll, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

vi.mock("../lib/db", () => ({
  getUserByEmail: vi.fn().mockResolvedValue(undefined),
  createUser: vi.fn(),
}));

function loginEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: "POST", path: "/auth/login" } },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    cookies: [],
  } as unknown as APIGatewayProxyEventV2;
}

describe("auth handler — async error propagation", () => {
  // Regression test: `return login(event)` (without `await`) inside the
  // handler's try block let rejections that happen after login()'s first
  // `await` (e.g. "user not found", thrown post-DB-call) escape the catch
  // block entirely, crashing the Lambda instead of returning 401 JSON.
  it("turns a rejected login into a clean 401 JSON response, not an unhandled crash", async () => {
    const { handler } = await import("./auth");
    const result = (await handler(
      loginEvent({ email: "nadie@example.com", password: "whatever123" })
    )) as APIGatewayProxyResultV2 & { statusCode: number; body: string };

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toMatch(/incorrectos/i);
  });
});

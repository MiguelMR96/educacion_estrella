import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("password hashing", () => {
  it("hashes and verifies a password round-trip", async () => {
    const { hashPassword, comparePassword } = await import("./auth");
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await comparePassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await comparePassword("wrong-password", hash)).toBe(false);
  });
});

describe("session cookies", () => {
  it("signs a session and requireSession accepts it back", async () => {
    const { signSession, requireSession, buildSessionCookie } = await import("./auth");
    const token = signSession({ sub: "user-1", email: "user@example.com" });
    const cookieHeader = buildSessionCookie(token);
    const cookiePair = cookieHeader.split(";")[0];

    const event = {
      cookies: [cookiePair],
    } as unknown as Parameters<typeof requireSession>[0];

    const session = requireSession(event);
    expect(session.sub).toBe("user-1");
    expect(session.email).toBe("user@example.com");
  });

  it("rejects a missing session", async () => {
    const { requireSession } = await import("./auth");
    const event = { cookies: [] } as unknown as Parameters<typeof requireSession>[0];
    expect(() => requireSession(event)).toThrow();
  });
});

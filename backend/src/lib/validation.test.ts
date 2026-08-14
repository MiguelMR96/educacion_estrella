import { describe, expect, it } from "vitest";
import { createApplicationSchema, registerSchema, uploadUrlSchema } from "./validation";

describe("registerSchema", () => {
  it("rejects passwords shorter than 8 characters", () => {
    const result = registerSchema.safeParse({ email: "a@b.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("normalizes email to lowercase", () => {
    const result = registerSchema.parse({ email: "USER@Example.com", password: "password123" });
    expect(result.email).toBe("user@example.com");
  });
});

describe("uploadUrlSchema", () => {
  it("rejects files larger than 200MB", () => {
    const result = uploadUrlSchema.safeParse({
      fileName: "video.mp4",
      fileType: "video/mp4",
      fileSize: 201 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported mime types", () => {
    const result = uploadUrlSchema.safeParse({
      fileName: "video.mov",
      fileType: "video/quicktime",
      fileSize: 1024,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid mp4 under the limit", () => {
    const result = uploadUrlSchema.safeParse({
      fileName: "entrevista.mp4",
      fileType: "video/mp4",
      fileSize: 50 * 1024 * 1024,
    });
    expect(result.success).toBe(true);
  });
});

describe("createApplicationSchema", () => {
  it("rejects a non-positive amount", () => {
    const result = createApplicationSchema.safeParse({
      applicationId: "8c2c9e2e-1b1b-4b1b-9b1b-1b1b1b1b1b1b",
      videoKey: "applications/u1/a1/video.mp4",
      fullName: "Jane Doe",
      documentId: "1234567890",
      institution: "Universidad Nacional",
      program: "Ingeniería",
      amount: 0,
    });
    expect(result.success).toBe(false);
  });
});

import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export const loginSchema = registerSchema;

export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm"] as const;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  fileType: z.enum(ALLOWED_VIDEO_TYPES, {
    errorMap: () => ({ message: "Formato de video no soportado. Usa .mp4 o .webm" }),
  }),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_VIDEO_BYTES, "El video supera el límite de 200 MB"),
});

export const createApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  videoKey: z.string().min(1),
  fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(150),
  documentId: z.string().trim().min(4, "Documento de identidad inválido").max(30),
  institution: z.string().trim().min(2, "Ingresa la institución educativa").max(150),
  program: z.string().trim().min(2, "Ingresa el programa académico").max(150),
  amount: z
    .number()
    .positive("El monto debe ser mayor a 0")
    .max(1_000_000_000, "Monto fuera de rango"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

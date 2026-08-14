import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createApplication, listApplicationsByUser } from "../lib/db";
import { createApplicationSchema, uploadUrlSchema, MAX_VIDEO_BYTES } from "../lib/validation";
import { requireSession } from "../lib/auth";
import { errorResponse, HttpError, json } from "../lib/http";
import { env } from "../lib/env";

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const session = requireSession(event); // every route here requires a session
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;

    // `await` matters here: without it, a rejection thrown after the callee's
    // first `await` lands outside this try block's synchronous execution and
    // `catch` never sees it (see the identical fix/comment in handlers/auth.ts).
    if (method === "POST" && path.endsWith("/applications/upload-url")) {
      return await uploadUrl(event, session.sub);
    }
    if (method === "POST" && path.endsWith("/applications")) {
      return await create(event, session.sub);
    }
    if (method === "GET" && path.endsWith("/applications")) {
      return await list(session.sub);
    }

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

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

async function uploadUrl(event: APIGatewayProxyEventV2, userId: string): Promise<APIGatewayProxyResultV2> {
  const parsed = uploadUrlSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new HttpError(400, "Datos de archivo inválidos", parsed.error.flatten());
  }
  const { fileName, fileType, fileSize } = parsed.data;

  const applicationId = uuidv4();
  const videoKey = `applications/${userId}/${applicationId}/${sanitizeFileName(fileName)}`;

  // S3 enforces type + the 200MB size cap itself via the POST policy conditions,
  // so an oversized or tampered upload is rejected by S3 before it reaches our
  // Lambda/bandwidth at all.
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: env.videosBucket,
    Key: videoKey,
    Conditions: [
      ["content-length-range", 1, MAX_VIDEO_BYTES],
      ["eq", "$Content-Type", fileType],
    ],
    Fields: { "Content-Type": fileType },
    Expires: 300, // 5 minutes to complete the upload
  });

  return json(200, { applicationId, videoKey, uploadUrl: url, fields, fileSizeAtRequest: fileSize });
}

async function create(event: APIGatewayProxyEventV2, userId: string): Promise<APIGatewayProxyResultV2> {
  const parsed = createApplicationSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new HttpError(400, "Datos de la solicitud inválidos", parsed.error.flatten());
  }
  const data = parsed.data;

  // Defense in depth: confirm the video actually landed in S3 (and belongs to
  // this user's prefix) before writing a DB record that references it.
  if (!data.videoKey.startsWith(`applications/${userId}/${data.applicationId}/`)) {
    throw new HttpError(400, "videoKey no corresponde a esta solicitud");
  }
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.videosBucket, Key: data.videoKey }));
  } catch {
    throw new HttpError(400, "El video no se encuentra en el almacenamiento. Vuelve a intentar la subida.");
  }

  const createdAt = new Date().toISOString();
  await createApplication({
    userId,
    sk: `${createdAt}#${data.applicationId}`,
    applicationId: data.applicationId,
    fullName: data.fullName,
    documentId: data.documentId,
    institution: data.institution,
    program: data.program,
    amount: data.amount,
    videoKey: data.videoKey,
    status: "recibida",
    createdAt,
  });

  return json(201, { applicationId: data.applicationId, status: "recibida", createdAt });
}

async function list(userId: string): Promise<APIGatewayProxyResultV2> {
  const applications = await listApplicationsByUser(userId);
  return json(
    200,
    applications.map((a) => ({
      applicationId: a.applicationId,
      fullName: a.fullName,
      institution: a.institution,
      program: a.program,
      amount: a.amount,
      status: a.status,
      createdAt: a.createdAt,
    }))
  );
}

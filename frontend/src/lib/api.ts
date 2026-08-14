const API_URL = import.meta.env.VITE_API_URL.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(data?.error ?? `Error ${res.status}`, res.status, data?.details);
  }
  return data as T;
}

export interface User {
  userId: string;
  email: string;
}

export function register(email: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export function me(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export interface UploadUrlResponse {
  applicationId: string;
  videoKey: string;
  uploadUrl: string;
  fields: Record<string, string>;
}

export function requestUploadUrl(file: {
  fileName: string;
  fileType: string;
  fileSize: number;
}): Promise<UploadUrlResponse> {
  return apiFetch<UploadUrlResponse>("/applications/upload-url", {
    method: "POST",
    body: JSON.stringify(file),
  });
}

// Direct browser -> S3 upload via presigned POST, with progress reporting.
// Bypasses our API entirely so the 200MB payload never touches Lambda.
export function uploadToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.append(key, value);
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`La subida a S3 falló (código ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Se perdió la conexión durante la subida"));
    xhr.onabort = () => reject(new Error("Subida cancelada"));

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.send(formData);
  });
}

export interface CreateApplicationInput {
  applicationId: string;
  videoKey: string;
  fullName: string;
  documentId: string;
  institution: string;
  program: string;
  amount: number;
}

export function createApplication(input: CreateApplicationInput): Promise<{ applicationId: string }> {
  return apiFetch("/applications", { method: "POST", body: JSON.stringify(input) });
}

export interface ApplicationSummary {
  applicationId: string;
  fullName: string;
  institution: string;
  program: string;
  amount: number;
  status: string;
  createdAt: string;
}

export function listApplications(): Promise<ApplicationSummary[]> {
  return apiFetch<ApplicationSummary[]>("/applications");
}

import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../lib/api";

const ALLOWED_TYPES = ["video/mp4", "video/webm"];
const MAX_BYTES = 200 * 1024 * 1024;

type Phase = "idle" | "requesting-url" | "uploading" | "saving" | "error";

interface FormState {
  fullName: string;
  documentId: string;
  institution: string;
  program: string;
  amount: string;
}

const emptyForm: FormState = { fullName: "", documentId: "", institution: "", program: "", amount: "" };

function validateForm(form: FormState, file: File | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.fullName.trim().length < 3) errors.fullName = "Ingresa el nombre completo";
  if (form.documentId.trim().length < 4) errors.documentId = "Documento de identidad inválido";
  if (form.institution.trim().length < 2) errors.institution = "Ingresa la institución educativa";
  if (form.program.trim().length < 2) errors.program = "Ingresa el programa académico";

  const amount = Number(form.amount);
  if (!form.amount || Number.isNaN(amount) || amount <= 0) errors.amount = "Ingresa un monto válido";

  if (!file) {
    errors.video = "Selecciona el video de la entrevista";
  } else if (!ALLOWED_TYPES.includes(file.type)) {
    errors.video = "Formato no soportado. Usa .mp4 o .webm";
  } else if (file.size > MAX_BYTES) {
    errors.video = `El video pesa ${(file.size / (1024 * 1024)).toFixed(0)} MB, el máximo es 200 MB`;
  }

  return errors;
}

export function ApplicationFormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  function updateField(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.video;
      return next;
    });
  }

  function handleCancelUpload() {
    abortRef.current?.abort();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const errors = validateForm(form, file);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !file) return;

    const amount = Number(form.amount);

    try {
      setPhase("requesting-url");
      const { applicationId, videoKey, uploadUrl, fields } = await api.requestUploadUrl({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      setPhase("uploading");
      setProgress(0);
      const controller = new AbortController();
      abortRef.current = controller;
      await api.uploadToS3(uploadUrl, fields, file, setProgress, controller.signal);

      setPhase("saving");
      await api.createApplication({
        applicationId,
        videoKey,
        fullName: form.fullName.trim(),
        documentId: form.documentId.trim(),
        institution: form.institution.trim(),
        program: form.program.trim(),
        amount,
      });

      navigate("/solicitudes");
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      abortRef.current = null;
    }
  }

  const busy = phase === "requesting-url" || phase === "uploading" || phase === "saving";

  return (
    <div className="form-card">
      <h1>Nueva solicitud de crédito</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Nombre completo
          <input
            value={form.fullName}
            onChange={(e) => updateField("fullName", e.target.value)}
            disabled={busy}
          />
          {fieldErrors.fullName && <span className="error-text">{fieldErrors.fullName}</span>}
        </label>

        <label>
          Documento de identidad
          <input
            value={form.documentId}
            onChange={(e) => updateField("documentId", e.target.value)}
            disabled={busy}
          />
          {fieldErrors.documentId && <span className="error-text">{fieldErrors.documentId}</span>}
        </label>

        <label>
          Institución educativa
          <input
            value={form.institution}
            onChange={(e) => updateField("institution", e.target.value)}
            disabled={busy}
          />
          {fieldErrors.institution && <span className="error-text">{fieldErrors.institution}</span>}
        </label>

        <label>
          Programa académico
          <input
            value={form.program}
            onChange={(e) => updateField("program", e.target.value)}
            disabled={busy}
          />
          {fieldErrors.program && <span className="error-text">{fieldErrors.program}</span>}
        </label>

        <label>
          Monto solicitado (COP)
          <input
            type="number"
            min="1"
            step="1"
            value={form.amount}
            onChange={(e) => updateField("amount", e.target.value)}
            disabled={busy}
          />
          {fieldErrors.amount && <span className="error-text">{fieldErrors.amount}</span>}
        </label>

        <label>
          Video de la entrevista (.mp4 o .webm, máximo 200 MB)
          <input type="file" accept="video/mp4,video/webm" onChange={handleFileChange} disabled={busy} />
          {file && <span className="file-name">{file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</span>}
          {fieldErrors.video && <span className="error-text">{fieldErrors.video}</span>}
        </label>

        {phase === "uploading" && (
          <div className="upload-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}% subido</span>
            <button type="button" onClick={handleCancelUpload}>
              Cancelar subida
            </button>
          </div>
        )}

        {phase === "requesting-url" && <p>Preparando la subida…</p>}
        {phase === "saving" && <p>Guardando la solicitud…</p>}

        {errorMessage && (
          <div className="error-banner">
            <p>{errorMessage}</p>
            <button type="button" onClick={() => setPhase("idle")}>
              Reintentar
            </button>
          </div>
        )}

        <button type="submit" disabled={busy}>
          {busy ? "Enviando…" : "Enviar solicitud"}
        </button>
      </form>
    </div>
  );
}

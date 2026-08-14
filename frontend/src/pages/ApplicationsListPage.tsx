import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";

export function ApplicationsListPage() {
  const [applications, setApplications] = useState<api.ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listApplications()
      .then(setApplications)
      .catch(() => setError("No se pudieron cargar las solicitudes"));
  }, []);

  return (
    <div className="list-card">
      <h1>Mis solicitudes</h1>

      {error && <p className="error-text">{error}</p>}

      {!error && applications === null && <p>Cargando…</p>}

      {applications?.length === 0 && (
        <p>
          Aún no tienes solicitudes. <Link to="/nueva-solicitud">Crea la primera</Link>.
        </p>
      )}

      {applications && applications.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Institución</th>
              <th>Programa</th>
              <th>Monto</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.applicationId}>
                <td>{a.fullName}</td>
                <td>{a.institution}</td>
                <td>{a.program}</td>
                <td>{a.amount.toLocaleString("es-CO", { style: "currency", currency: "COP" })}</td>
                <td>{a.status}</td>
                <td>{new Date(a.createdAt).toLocaleString("es-CO")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

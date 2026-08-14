import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <div className="page-center">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

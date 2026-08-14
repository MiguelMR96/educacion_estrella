import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth-context";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ApplicationFormPage } from "./pages/ApplicationFormPage";
import { ApplicationsListPage } from "./pages/ApplicationsListPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/nueva-solicitud" element={<ApplicationFormPage />} />
            <Route path="/solicitudes" element={<ApplicationsListPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/solicitudes" replace />} />
          <Route path="*" element={<Navigate to="/solicitudes" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

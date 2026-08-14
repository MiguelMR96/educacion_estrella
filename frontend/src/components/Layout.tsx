import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">Educación Estrella</span>
        {user && (
          <nav className="nav">
            <Link to="/solicitudes">Mis solicitudes</Link>
            <Link to="/nueva-solicitud">Nueva solicitud</Link>
            <span className="user-email">{user.email}</span>
            <button onClick={handleLogout}>Cerrar sesión</button>
          </nav>
        )}
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

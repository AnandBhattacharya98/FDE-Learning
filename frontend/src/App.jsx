import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { ThemeToggle } from "./theme.jsx";
import Login from "./pages/Login.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";
import Home from "./pages/Home.jsx";
import Week from "./pages/Week.jsx";
import GodMode from "./pages/GodMode.jsx";
import Teach from "./pages/Teach.jsx";
import Coach from "./components/Coach.jsx";

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2" /></svg>
    </span>
  );
}

export default function App() {
  const { user, signOut } = useAuth();
  return (
    <>
      <header className={`topbar${user ? " authed" : ""}`}>
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <BrandMark />
            <span className="brand-name">FDE Learning</span>
            <span className="brand-tag">RevRag</span>
          </Link>
          <div className="topbar-actions">
            {user?.teacher && (
              <NavLink to="/teach" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} title="Teacher mode">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-5 9 5-9 5-9-5zM7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5" /></svg>
                <span>Teach</span>
              </NavLink>
            )}
            {user?.admin && (
              <NavLink to="/god" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} title="God mode (admin)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4zM8 19h8M12 15v4" /><path d="M7 11l2-2 2 2 3-3 3 3" /></svg>
                <span>God mode</span>
              </NavLink>
            )}
            {user && <span className="topbar-sep" aria-hidden="true" />}
            <ThemeToggle />
            {user && (
              <div className="user-chip">
                <span className="user-initial" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
                <span className="user-name">{user.name}</span>
                <button className="nav-link" onClick={signOut} title="Log out">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
                  <span className="nav-label">Log out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="shell">
        <main>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/weeks/:weekId/:itemId?" element={<RequireAuth><Week /></RequireAuth>} />
            <Route path="/god" element={<RequireAuth><GodMode /></RequireAuth>} />
            <Route path="/teach" element={<RequireAuth><Teach /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {user && <Coach />}
    </>
  );
}

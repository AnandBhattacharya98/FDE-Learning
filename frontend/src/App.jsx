import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { ThemeToggle } from "./theme.jsx";
import Login from "./pages/Login.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";
import Home from "./pages/Home.jsx";
import Week from "./pages/Week.jsx";
import GodMode from "./pages/GodMode.jsx";

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
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <BrandMark />
            <span className="brand-name">FDE Learning</span>
            <span className="brand-tag">by RevRag</span>
          </Link>
          <div className="topbar-actions">
            <ThemeToggle />
            {user?.admin && <Link to="/god" className="gm-link-top">GOD MODE</Link>}
            {user && (
              <div className="user-chip">
                <span className="user-initial" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
                <span className="user-name">{user.name}</span>
                <button className="btn ghost small-btn" onClick={signOut}>Log out</button>
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

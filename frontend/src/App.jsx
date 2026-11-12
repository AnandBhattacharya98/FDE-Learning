import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
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

export default function App() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">FDE Learning <span>· RevRag</span></Link>
        {user && (
          <div className="small">
            {user.admin && <><Link to="/god" className="gm-link-top">GOD MODE</Link>{" "}</>}
            <span className="muted">{user.name} · </span>
            <button className="btn link" onClick={signOut}>Log out</button>
          </div>
        )}
      </header>
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
  );
}

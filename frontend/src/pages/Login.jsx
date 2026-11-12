import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, BASE } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api("/auth/providers").then((p) => setGoogle(!!p.google)).catch(() => {});
    // Google sign-in problems come back as /login#error=...
    const err = new URLSearchParams(window.location.hash.slice(1)).get("error");
    if (err) {
      setError(err);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (user) return <Navigate to={location.state?.from || "/"} replace />;

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = mode === "signup" ? form : { email: form.email, password: form.password };
      const data = await api(`/auth/${mode}`, { method: "POST", body });
      signIn(data);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === "signup";
  return (
    <div className="auth-wrap">
      <h1>{signup ? "Create your account" : "Log in"}</h1>
      <p className="muted">Your quiz scores and project progress are saved to your account.</p>
      <form className="card" onSubmit={submit} noValidate>
        {google && (
          <>
            <a className="btn" style={{ width: "100%", gap: 10 }}
               href={`${BASE}/auth/google/start?next=${encodeURIComponent(location.state?.from || "/")}`}>
              <GoogleLogo /> Continue with Google
            </a>
            <p className="small muted" style={{ textAlign: "center", margin: "14px 0 4px" }}>or use your email</p>
          </>
        )}
        {signup && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" type="text" autoComplete="name" value={form.name} onChange={update("name")} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={update("email")} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={signup ? "new-password" : "current-password"}
                 value={form.password} onChange={update("password")} required minLength={signup ? 8 : undefined}
                 aria-describedby={signup ? "pw-hint" : undefined} />
          {signup && <p id="pw-hint" className="small muted" style={{ marginTop: 4 }}>At least 8 characters.</p>}
        </div>
        {error && <p className="notice error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? "One moment…" : signup ? "Create account" : "Log in"}
        </button>
      </form>
      <p className="small" style={{ marginTop: 16 }}>
        {signup ? "Already have an account? " : "New here? "}
        <button className="btn link" onClick={() => { setMode(signup ? "login" : "signup"); setError(""); }}>
          {signup ? "Log in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

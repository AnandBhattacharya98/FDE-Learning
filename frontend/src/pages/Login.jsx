import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { AgentStage } from "../components/Agent.jsx";

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="auth-layout">
      <div className="auth-wrap">
      <span className="eyebrow">FDE training</span>
      <h1 className="display" style={{ marginTop: 12 }}>{signup ? <>Create your <span className="grad-text">account</span></> : <>Welcome <span className="grad-text">back</span></>}</h1>
      <p className="muted">{signup ? "Your quiz scores and project progress are saved to your account." : "Log in to pick up where you left off. Your quiz scores and project progress are saved to your account."}</p>
      <form className="card" onSubmit={submit} noValidate>
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
      <AgentStage
        compact
        label="A voice coach agent quizzing a learner"
        fields={[
          { label: "Lesson", value: "How a voice agent works", state: "done" },
          { label: "Project", value: "P2: your own voice bot", state: "active" },
        ]}
        bubble="Explain what an API does, the way you would to a client."
        name="Voice coach"
        status="Listening"
      />
    </div>
  );
}

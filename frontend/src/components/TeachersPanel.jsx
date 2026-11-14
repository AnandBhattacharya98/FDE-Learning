import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// God mode: who can open teacher mode (/teach). Teachers from TEACHER_EMAILS (Render) are listed
// but can only be removed there; the rest are added and removed here. Admins are always teachers.

export default function TeachersPanel() {
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api("/admin/teachers").then((r) => setRows(r.teachers)).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    setErr("");
    try { setRows((await api("/admin/teachers", { method: "POST", body: { email } })).teachers); setEmail(""); }
    catch (e2) { setErr(e2.message); }
  }
  async function remove(id) {
    setRows((await api(`/admin/teachers/${id}`, { method: "DELETE" })).teachers);
  }

  return (
    <section className="gm-panel" aria-labelledby="tp-title">
      <div className="gm-board-head">
        <h2 id="tp-title">Teachers</h2>
        <span className="gm-meta">they sign in with Google and open /teach</span>
      </div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <label htmlFor="tp-email" className="visually-hidden">Teacher's email</label>
        <input id="tp-email" type="email" required placeholder="teacher@revrag.ai" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: "1 1 240px", minHeight: 40 }} />
        <button className="btn small-btn" type="submit">Make teacher</button>
      </form>
      {err && <p className="notice error" role="alert">{err}</p>}
      {rows && rows.length === 0 && <p className="gm-meta">No teachers yet. You (the admin) can always open teacher mode.</p>}
      {rows?.length > 0 && <div className="ab-list">
        {rows?.map((t) => (
          <div key={`${t.source}-${t.email}`} className="ab-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "default" }}>
            <span><strong>{t.name || "Hasn't signed in yet"}</strong> <span className="gm-meta">{t.email}</span></span>
            {t.source === "env" ? <span className="gm-meta">TEACHER_EMAILS</span>
              : <button type="button" className="btn ghost small-btn" onClick={() => remove(t.id)} aria-label={`Remove ${t.email} as teacher`}>Remove</button>}
          </div>
        ))}
      </div>}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// Who can open teacher mode (/teach). In God mode (base "/admin") the admin adds and removes
// teachers; on the Teach page (base "/teacher") teachers can invite others but not remove anyone.
// Teachers from TEACHER_EMAILS (Render) can only be removed there. Admins are always teachers.

export default function TeachersPanel({ base = "/admin" }) {
  const canRemove = base === "/admin";
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api(`${base}/teachers`).then((r) => setRows(r.teachers)).catch((e) => setErr(e.message)), [base]);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    setErr("");
    try { setRows((await api(`${base}/teachers`, { method: "POST", body: { email } })).teachers); setEmail(""); }
    catch (e2) { setErr(e2.message); }
  }
  async function remove(id) {
    setRows((await api(`/admin/teachers/${id}`, { method: "DELETE" })).teachers);
  }

  return (
    <section className="gm-panel" aria-labelledby="tp-title">
      <div className="gm-board-head">
        <h2 id="tp-title">Teachers</h2>
        <span className="gm-meta">{canRemove ? "they sign in with Google and open /teach" : "invite a colleague: they sign in with Google and get this page. Only the admin can remove teachers."}</span>
      </div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <label htmlFor="tp-email" className="visually-hidden">Teacher's email</label>
        <input id="tp-email" type="email" required placeholder="colleague@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: "1 1 240px", minHeight: 40 }} />
        <button className="btn small-btn" type="submit">{canRemove ? "Make teacher" : "Invite teacher"}</button>
      </form>
      {err && <p className="notice error" role="alert">{err}</p>}
      {rows && rows.length === 0 && <p className="gm-meta">No teachers yet. You (the admin) can always open teacher mode.</p>}
      {rows?.length > 0 && <div className="ab-list">
        {rows?.map((t) => (
          <div key={`${t.source}-${t.email}`} className="ab-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "default" }}>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong>{t.name || "Hasn't signed in yet"}</strong> <span className="gm-meta">{t.email}</span>
              {t.added_by && <span className="gm-meta"> · invited by {t.added_by}</span>}
            </span>
            {t.source === "env" ? <span className="gm-meta">TEACHER_EMAILS</span>
              : canRemove && <button type="button" className="btn ghost small-btn" onClick={() => remove(t.id)} aria-label={`Remove ${t.email} as teacher`}>Remove</button>}
          </div>
        ))}
      </div>}
    </section>
  );
}

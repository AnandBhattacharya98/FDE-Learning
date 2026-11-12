import { useEffect, useState } from "react";
import { api } from "../api.js";
import GradeCard from "./GradeCard.jsx";
import Illustration from "./Illustration.jsx";

function SubmitField({ weekId, projectId, field, saved, onSaved }) {
  const [value, setValue] = useState(saved || "");
  const [state, setState] = useState({ kind: "", msg: "" });
  useEffect(() => setValue(saved || ""), [saved]);

  async function save() {
    setState({ kind: "", msg: "Saving…" });
    try {
      await api(`/weeks/${weekId}/projects/${projectId}/submission/${field.id}`, { method: "PUT", body: { value } });
      setState({ kind: "ok", msg: field.id === "repo_url" && value ? "Saved. Grading has started below." : "Saved" });
      onSaved?.();
    } catch (e) {
      setState({ kind: "error", msg: e.message });
    }
  }

  const id = `${projectId}-${field.id}`;
  const Input = field.kind === "text" ? "textarea" : "input";
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <Input id={id} type={field.kind === "url" ? "url" : undefined} value={value}
             placeholder={field.kind === "url" ? "https://" : ""}
             onChange={(e) => { setValue(e.target.value); setState({ kind: "", msg: "" }); }}
             onBlur={() => value !== (saved || "") && save()} />
      <div className={`small ${state.kind === "error" ? "" : "muted"}`} role="status"
           style={{ minHeight: 20, color: state.kind === "error" ? "var(--bad)" : undefined }}>{state.msg}</div>
    </div>
  );
}

export default function Projects({ week, only, progress, onChange }) {
  const [error, setError] = useState("");
  // Ticks show at once; the server copy replaces them when progress reloads.
  const [pending, setPending] = useState({});
  const [graded, setGraded] = useState(0); // bumps when a repo link is saved, to refresh the grade card
  useEffect(() => setPending({}), [progress]);

  async function toggle(projectId, index, done) {
    setError("");
    setPending((p) => ({ ...p, [`${projectId}-${index}`]: done }));
    try {
      await api(`/weeks/${week.id}/projects/${projectId}/steps/${index}`, { method: "PUT", body: { done } });
    } catch (e) {
      setError(e.message);
    }
    onChange();
  }

  return (
    <div className="stack">
      {error && <p className="notice error" role="alert">{error}</p>}
      {week.projects.filter((p) => !only || p.id === only).map((p) => {
        const mine = progress?.projects?.[p.id] || { steps_done: [], submission: {} };
        return (
          <section key={p.id} className="card" aria-labelledby={`proj-${p.id}`}>
            <span className="pill">{p.id}</span>
            <h3 className="project-title" id={`proj-${p.id}`} style={{ marginTop: 8 }}>{p.title}</h3>
            <p className="muted">{p.summary}</p>
            {(() => {
              const fig = week.illustrations.find((i) => i.id === `${p.id.toLowerCase()}-architecture`);
              return fig ? <Illustration id={fig.id} brief={fig} /> : null;
            })()}
            <h4>Steps</h4>
            {p.steps.map((s, i) => {
              const id = `${p.id}-step-${i}`;
              return (
                <div key={i} className="step">
                  <input id={id} type="checkbox" checked={pending[`${p.id}-${i}`] ?? mine.steps_done.includes(i)}
                         onChange={(e) => toggle(p.id, i, e.target.checked)} />
                  <label htmlFor={id} style={{ fontWeight: 400, margin: 0 }}>{s}</label>
                </div>
              );
            })}
            <p className="notice ok" style={{ marginTop: 12 }}><strong>Done when:</strong> {p.done_when}</p>
            {p.warning && <p className="notice warn">{p.warning}</p>}
            <h4 style={{ marginTop: 20 }}>What you submit</h4>
            <p className="small muted">Saved to your account when you leave each box. Never paste keys or passwords here.</p>
            {p.submit.map((f) => (
              <SubmitField key={f.id} weekId={week.id} projectId={p.id} field={f} saved={mine.submission[f.id]}
                           onSaved={f.id === "repo_url" ? () => setGraded((n) => n + 1) : undefined} />
            ))}
            <GradeCard weekId={week.id} projectId={p.id} refreshKey={graded} />
          </section>
        );
      })}
    </div>
  );
}

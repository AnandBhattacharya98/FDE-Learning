import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon, KIND_LABEL, fileHref } from "./teacher/common.jsx";
import { MaterialPreview } from "./teacher/Materials.jsx";
import "../teacher.css";

// "From your teachers": the videos, slides and quizzes teachers published for this week.
// Data: GET /weeks/:id/class. Quizzes are graded on the server (answers never reach the browser first).

function ClassQuiz({ quiz, onDone }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = result ? Object.fromEntries(result.results.map((r) => [r.id, r])) : {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { setResult(await api(`/class-quizzes/${quiz.id}/attempt`, { method: "POST", body: { answers } })); onDone(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ marginTop: 12 }}>
      {result && (
        <div className={`notice ${result.passed ? "ok" : "warn"}`} role="status">
          You scored <strong>{result.score} of {result.total}</strong>. {result.passed ? "You passed." : `The pass mark is ${result.pass_percent}%.`}{" "}
          <button type="button" className="btn link" onClick={() => { setAnswers({}); setResult(null); }}>Try again</button>
        </div>
      )}
      {quiz.questions.map((q, n) => {
        const r = byId[q.id];
        return (
          <fieldset key={q.id} className="card" style={{ margin: 0, padding: 18 }}>
            <legend className="small muted" style={{ padding: 0, float: "left", width: "100%" }}>Question {n + 1}</legend>
            <p style={{ clear: "both" }}><strong>{q.question}</strong></p>
            {q.options.map((opt, i) => (
              <label key={i} className={`option${r && i === r.answer ? " correct" : r && i === r.chosen ? " wrong" : ""}`} style={{ fontWeight: 400, marginBottom: 0 }}>
                <input type="radio" name={`cq-${quiz.id}-${q.id}`} checked={answers[q.id] === i} disabled={!!result} onChange={() => setAnswers({ ...answers, [q.id]: i })} />
                <span>{opt}</span>
              </label>
            ))}
            {r && <p className="small" style={{ marginTop: 10 }}><strong style={{ color: r.correct ? "var(--ok)" : "var(--bad)" }}>{r.correct ? "Correct." : "Not quite."}</strong> {r.explanation}</p>}
          </fieldset>
        );
      })}
      {err && <p className="notice error" role="alert">{err}</p>}
      {!result && <button className="btn primary" type="submit" disabled={busy || !Object.keys(answers).length}>{busy ? "Checking…" : `Submit ${Object.keys(answers).length} of ${quiz.questions.length} answers`}</button>}
    </form>
  );
}

export default function ClassMaterials({ week, moduleId }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api(`/weeks/${week.id}/class`).then(setData).catch(() => setData({ materials: [], quizzes: [] })), [week.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpen(null); }, [moduleId]);
  // The coach links teacher materials as #class-h; scroll there once the box has loaded.
  useEffect(() => {
    if (data && window.location.hash === "#class-h") document.getElementById("class-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data, moduleId]);

  if (!data || (!data.materials.length && !data.quizzes.length)) return null;
  // This module's things first, then the rest of the week.
  const rank = (x) => (x.module_id === moduleId ? 0 : x.module_id ? 2 : 1);
  const items = [...data.materials.map((m) => ({ ...m, type: "material" })), ...data.quizzes.map((q) => ({ ...q, type: "quiz", kind: "quiz" }))]
    .sort((a, b) => rank(a) - rank(b));
  const modTitle = Object.fromEntries(week.modules.map((m) => [m.id, m.title]));

  return (
    <section className="card class-box" aria-labelledby="class-h">
      <h3 id="class-h">From your teachers <span className="pill">{items.length}</span></h3>
      <p className="small muted" style={{ margin: 0 }}>Recordings, slides and extra quizzes for week {week.number}. They don't change your course progress.</p>
      <div className="class-list">
        {items.map((x) => {
          const k = `${x.type}-${x.id}`;
          const isOpen = open === k;
          return (
            <div key={k}>
              <div className="tc-rowi">
                <button type="button" className="tc-row-main" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)}>
                  <Icon name={x.kind} />
                  <span style={{ minWidth: 0 }}>
                    <span className="t">{x.title}</span>
                    <span className="s">{x.type === "quiz" ? `Quiz · ${x.questions.length} questions` : KIND_LABEL[x.kind]}{x.module_id ? ` · ${modTitle[x.module_id] || ""}` : ""}</span>
                  </span>
                </button>
                <span className="r">
                  {x.type === "quiz" && x.best && <span className={`tc-pill ${x.best.passed ? "ok" : "warn"}`}>best {x.best.score}/{x.best.total}</span>}
                  {x.type === "material" && x.url && !x.embed_url && <a className="tc-pill accent" href={x.url} target="_blank" rel="noreferrer">Open link</a>}
                  {x.type === "material" && x.file_url && <a className="tc-pill" href={fileHref(x.file_url)} target="_blank" rel="noreferrer" download={x.file_name}>Download</a>}
                </span>
              </div>
              {isOpen && (
                <div style={{ padding: "4px 2px 10px" }}>
                  {x.description && <p className="small" style={{ margin: "10px 0 0" }}>{x.description}</p>}
                  {x.type === "material" ? <MaterialPreview m={x} /> : <ClassQuiz quiz={x} onDone={load} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

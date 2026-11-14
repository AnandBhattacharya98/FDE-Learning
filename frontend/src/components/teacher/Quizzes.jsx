import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import { Drawer, Icon, Seg, WeekModuleSelect, ago } from "./common.jsx";

// Teacher mode: Claude writes a quiz from chosen materials (and the week's lessons); the teacher
// edits every question and publishes. Learners see published quizzes under "From your teachers".

const STATUS = { generating: ["Writing…", "accent"], draft: ["Draft", "warn"], published: ["Published", "ok"], failed: ["Failed", "bad"] };

function Generate({ weeks, materials, ai, model, onStarted }) {
  const [weekId, setWeekId] = useState(weeks[0]?.id || "");
  const [moduleId, setModuleId] = useState("");
  const [picked, setPicked] = useState([]);
  const [lessons, setLessons] = useState(true);
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState("mixed");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mats = materials.filter((m) => m.week_id === weekId && (!moduleId || !m.module_id || m.module_id === moduleId));

  async function go(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const q = await api("/teacher/quizzes/generate", { method: "POST", body: {
        week_id: weekId, module_id: moduleId || null, material_ids: picked, use_week_lessons: lessons,
        count: Number(count), difficulty, focus } });
      setPicked([]); setFocus("");
      onStarted(q.id);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function blank() {
    setErr("");
    try {
      const q = await api("/teacher/quizzes", { method: "POST", body: { week_id: weekId, module_id: moduleId || null, title: "New quiz", questions: [] } });
      onStarted(q.id, true);
    } catch (e2) { setErr(e2.message); }
  }

  return (
    <form className="tc-card tc-form" onSubmit={go} aria-labelledby="gen-title">
      <div>
        <h2 id="gen-title">Generate a quiz</h2>
        <p className="muted small" style={{ margin: 0 }}>Claude reads the materials you pick and writes multiple-choice questions. Nothing reaches learners until you check it and press Publish.</p>
      </div>
      {!ai && <p className="notice warn small">Generation is off until <code>ANTHROPIC_API_KEY</code> is set on the server. You can still write a quiz by hand.</p>}
      <WeekModuleSelect weeks={weeks} weekId={weekId} moduleId={moduleId} onWeek={(w) => { setWeekId(w); setModuleId(""); setPicked([]); }} onModule={setModuleId} idPrefix="gen" />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 6 }}>Sources</legend>
        <label className="tc-check"><input type="checkbox" checked={lessons} onChange={(e) => setLessons(e.target.checked)} /> This week's lessons{moduleId ? " (this module)" : ""}</label>
        {mats.map((m) => (
          <label key={m.id} className="tc-check" style={{ marginTop: 6 }}>
            <input type="checkbox" disabled={!m.has_text} checked={picked.includes(m.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />
            <span>{m.title}{!m.has_text && <span className="muted small"> · add a transcript or notes to use this</span>}</span>
          </label>
        ))}
        {mats.length === 0 && <p className="tc-hint">No materials for this week yet. Add some in Materials, or use the lessons.</p>}
      </fieldset>
      <div className="tc-row2">
        <div>
          <label htmlFor="gen-count">Questions</label>
          <input id="gen-count" type="number" min={3} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div>
          <span style={{ display: "block", fontWeight: 600, fontSize: "0.9rem", marginBottom: 4 }}>Difficulty</span>
          <Seg label="Difficulty" value={difficulty} onChange={setDifficulty} options={[["easy", "Easy"], ["mixed", "Mixed"], ["hard", "Hard"]]} />
        </div>
      </div>
      <div>
        <label htmlFor="gen-focus">Focus <span className="muted small">(optional)</span></label>
        <input id="gen-focus" type="text" maxLength={600} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. webhook retries and latency budgets" />
      </div>
      {err && <p className="notice error" role="alert">{err}</p>}
      <div className="tc-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" type="submit" disabled={busy || !ai || (!lessons && picked.length === 0)}>{busy ? "Starting…" : "Generate with Claude"}</button>
        <button className="btn" type="button" onClick={blank}>Write one by hand</button>
      </div>
      {ai && <p className="tc-hint">Uses {model}. Takes about a minute.</p>}
    </form>
  );
}

const blankQ = () => ({ question: "", options: ["", "", "", ""], answer: 0, explanation: "", source: "" });

function Editor({ quiz, weeks, onClose, onSaved }) {
  const [title, setTitle] = useState(quiz.title);
  const [pass, setPass] = useState(quiz.pass_percent);
  const [moduleId, setModuleId] = useState(quiz.module_id || "");
  const [qs, setQs] = useState(quiz.questions);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [results, setResults] = useState(null);
  const week = weeks.find((w) => w.id === quiz.week_id);

  useEffect(() => {
    if (quiz.status === "published") api(`/teacher/quizzes/${quiz.id}/results`).then(setResults).catch(() => {});
  }, [quiz.id, quiz.status]);
  useEffect(() => { // pick up Claude's questions when generation finishes
    if (!dirty) { setTitle(quiz.title); setQs(quiz.questions); }
  }, [quiz, dirty]);

  const edit = (i, patch) => { setQs(qs.map((q, n) => (n === i ? { ...q, ...patch } : q))); setDirty(true); };
  const editOpt = (i, j, v) => edit(i, { options: qs[i].options.map((o, k) => (k === j ? v : o)) });
  const dropOpt = (i, j) => {
    const q = qs[i];
    if (q.options.length <= 2) return;
    edit(i, { options: q.options.filter((_, k) => k !== j), answer: q.answer === j ? 0 : q.answer > j ? q.answer - 1 : q.answer });
  };

  async function save(publish) {
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/teacher/quizzes/${quiz.id}`, { method: "PUT", body: { title, pass_percent: Number(pass), module_id: moduleId || null, questions: qs } });
      setDirty(false);
      if (publish !== undefined) await api(`/teacher/quizzes/${quiz.id}/publish`, { method: "POST", body: { published: publish } });
      setMsg(publish === true ? "Published. Learners see it on the week page." : publish === false ? "Unpublished." : "Saved.");
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm?.(`Delete “${quiz.title}” and its results?`)) return;
    await api(`/teacher/quizzes/${quiz.id}`, { method: "DELETE" });
    onSaved(); onClose();
  }

  const [label, tone] = STATUS[quiz.status] || [quiz.status, ""];
  const byQ = Object.fromEntries((results?.questions || []).map((q) => [q.id, q.correct_percent]));
  return (
    <Drawer label={`Quiz: ${quiz.title}`} onClose={onClose}>
      <span className="eyebrow">Week {week?.number} quiz</span>
      <h2 style={{ marginTop: 10 }}>{quiz.title}</h2>
      <p className="small muted"><span className={`tc-pill ${tone}`}>{label}</span> {quiz.generated_by !== "manual" ? `· written by ${quiz.generated_by}` : "· written by hand"} · updated {ago(quiz.updated_at)}</p>
      {quiz.message && <p className={`notice ${quiz.status === "failed" ? "error" : quiz.status === "generating" ? "warn" : "ok"} small`}>{quiz.message}</p>}
      {quiz.status !== "generating" && (
        <>
          <div className="tc-form" style={{ marginTop: 12 }}>
            <div><label htmlFor="qz-title">Title</label><input id="qz-title" type="text" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></div>
            <div className="tc-row2">
              <div>
                <label htmlFor="qz-mod">Module</label>
                <select id="qz-mod" className="tc-select" value={moduleId} onChange={(e) => { setModuleId(e.target.value); setDirty(true); }}>
                  <option value="">Whole week</option>
                  {week?.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
              <div><label htmlFor="qz-pass">Pass mark (%)</label><input id="qz-pass" type="number" min={1} max={100} value={pass} onChange={(e) => { setPass(e.target.value); setDirty(true); }} /></div>
            </div>
          </div>

          <div className="tc-section">
            <h3>{qs.length} question{qs.length === 1 ? "" : "s"} <span className="muted small" style={{ fontWeight: 400 }}>· pick the correct answer with the circle</span></h3>
            {qs.map((q, i) => (
              <div key={i} className="tc-q">
                <div className="tc-q-head">
                  <strong className="small">Question {i + 1}{q.source ? <span className="muted" style={{ fontWeight: 400 }}> · from {q.source}</span> : null}</strong>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {byQ[q.id] != null && <span className={`tc-pill ${byQ[q.id] < 50 ? "bad" : "ok"}`} title="Learners who got it right on their latest try">{byQ[q.id]}% right</span>}
                    <button type="button" className="tc-x" aria-label={`Remove question ${i + 1}`} onClick={() => { setQs(qs.filter((_, n) => n !== i)); setDirty(true); }}>×</button>
                  </span>
                </div>
                <textarea aria-label={`Question ${i + 1}`} rows={2} value={q.question} onChange={(e) => edit(i, { question: e.target.value })} />
                {q.options.map((o, j) => (
                  <div key={j} className={`tc-opt${q.answer === j ? " correct" : ""}`}>
                    <input type="radio" name={`ans-${i}`} checked={q.answer === j} onChange={() => edit(i, { answer: j })} aria-label={`Option ${j + 1} is correct`} />
                    <input type="text" value={o} onChange={(e) => editOpt(i, j, e.target.value)} aria-label={`Question ${i + 1} option ${j + 1}`} />
                    <button type="button" className="tc-x" aria-label={`Remove option ${j + 1}`} onClick={() => dropOpt(i, j)} disabled={q.options.length <= 2}>×</button>
                  </div>
                ))}
                {q.options.length < 6 && <button type="button" className="btn link small" style={{ marginTop: 6 }} onClick={() => edit(i, { options: [...q.options, ""] })}>+ Add option</button>}
                <label htmlFor={`exp-${i}`} className="small" style={{ marginTop: 8 }}>Explanation shown after answering</label>
                <textarea id={`exp-${i}`} rows={2} value={q.explanation} onChange={(e) => edit(i, { explanation: e.target.value })} />
              </div>
            ))}
            <button type="button" className="btn small-btn" style={{ marginTop: 10 }} onClick={() => { setQs([...qs, blankQ()]); setDirty(true); }}>+ Add question</button>
          </div>

          {err && <p className="notice error" role="alert" style={{ marginTop: 12 }}>{err}</p>}
          {msg && <p className="notice ok" role="status" style={{ marginTop: 12 }}>{msg}</p>}
          <div className="tc-actions">
            <button className="btn primary" disabled={busy} onClick={() => save(quiz.status === "published" ? undefined : true)}>
              {quiz.status === "published" ? "Save changes" : "Save and publish"}
            </button>
            {quiz.status !== "published" && <button className="btn" disabled={busy} onClick={() => save()}>Save draft</button>}
            {quiz.status === "published" && <button className="btn" disabled={busy} onClick={() => save(false)}>Unpublish</button>}
            <button className="btn ghost" onClick={remove}>Delete</button>
          </div>

          {results && (
            <div className="tc-section">
              <h3>Results · {results.learners.length} learner{results.learners.length === 1 ? "" : "s"}</h3>
              {results.learners.length === 0 && <p className="muted small">Nobody has taken it yet.</p>}
              <div className="tc-list">
                {results.learners.map((l) => (
                  <div key={l.user_id} className="tc-rowi" style={{ cursor: "default" }}>
                    <span style={{ minWidth: 0 }}><span className="t">{l.name}</span><span className="s">{l.attempts} attempt{l.attempts === 1 ? "" : "s"} · last {ago(l.last_at)}</span></span>
                    <span className="r"><span className={`tc-pill ${l.passed ? "ok" : "bad"}`}>best {l.best}%</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

export default function Quizzes({ weeks, onChange }) {
  const [data, setData] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(() => api("/teacher/quizzes").then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
    api("/teacher/materials").then((r) => setMaterials(r.materials)).catch(() => {});
  }, [load]);
  const generating = data?.quizzes.some((q) => q.status === "generating");
  useEffect(() => {
    if (!generating) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [generating, load]);
  const changed = useCallback(() => { load(); onChange?.(); }, [load, onChange]);

  const weekNo = Object.fromEntries(weeks.map((w) => [w.id, w.number]));
  const modTitle = Object.fromEntries(weeks.flatMap((w) => w.modules.map((m) => [m.id, m.title])));
  const list = (data?.quizzes || []).filter((q) => filter === "all" || q.status === filter || (filter === "draft" && q.status !== "published"));
  const current = data?.quizzes.find((q) => q.id === open);

  return (
    <div className="tc-grid">
      <Generate weeks={weeks} materials={materials} ai={!!data?.ai} model={data?.model} onStarted={(id) => { setOpen(id); changed(); }} />
      <section className="tc-card" aria-labelledby="qz-list">
        <div className="tc-toolbar">
          <h2 id="qz-list" style={{ margin: 0 }}>Quizzes</h2>
          <Seg label="Filter quizzes" value={filter} onChange={setFilter} options={[["all", "All"], ["draft", "Drafts"], ["published", "Published"]]} />
        </div>
        {err && <p className="notice error">{err}</p>}
        {!data && !err && <p className="muted">Loading…</p>}
        {data && list.length === 0 && <p className="tc-empty">No quizzes yet. Generate one from this week's slides.</p>}
        <div className="tc-list">
          {list.map((q) => {
            const [label, tone] = STATUS[q.status] || [q.status, ""];
            return (
              <div key={q.id} className="tc-rowi">
                <button type="button" className="tc-row-main" onClick={() => setOpen(q.id)}>
                  <Icon name="quiz" />
                  <span style={{ minWidth: 0 }}>
                    <span className="t">{q.title}</span>
                    <span className="s">Week {weekNo[q.week_id]}{q.module_id ? ` · ${modTitle[q.module_id]}` : ""} · {q.count} questions · pass {q.pass_percent}%</span>
                  </span>
                </button>
                <span className="r">
                  {q.status === "published" && <span className="tc-pill">{q.learners} took it</span>}
                  <span className={`tc-pill ${tone}`}>{label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {current && <Editor quiz={current} weeks={weeks} onClose={() => setOpen(null)} onSaved={changed} />}
    </div>
  );
}

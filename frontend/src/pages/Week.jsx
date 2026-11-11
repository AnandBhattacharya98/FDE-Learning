import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { MANUAL, TYPE_LABEL, flatItems } from "../components/courseItems.js";
import CourseNav from "../components/CourseNav.jsx";
import ItemView from "../components/ItemView.jsx";
import "../course.css";

export default function Week() {
  const { weekId, itemId } = useParams();
  const navigate = useNavigate();
  const [week, setWeek] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(
    () => api(`/weeks/${weekId}/items/progress`).then(setProgress).catch(() => {}),
    [weekId]
  );

  useEffect(() => {
    setWeek(null);
    setError("");
    api(`/weeks/${weekId}`).then(setWeek).catch((e) => setError(e.message));
    refresh();
  }, [weekId, refresh]);

  useEffect(() => { setNavOpen(false); window.scrollTo({ top: 0 }); }, [itemId]);

  const items = useMemo(() => (week ? flatItems(week) : []), [week]);
  const done = useMemo(() => new Set(progress?.items_done || []), [progress]);

  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!week) return <p className="muted">Loading…</p>;

  if (!itemId) {
    if (!progress) return <p className="muted">Loading…</p>;
    const next = items.find((i) => !done.has(i.id)) || items[0];
    return <Navigate to={`/weeks/${weekId}/${next.id}`} replace />;
  }

  const index = items.findIndex((i) => i.id === itemId);
  if (index === -1) return <Navigate to={`/weeks/${weekId}`} replace />;
  const item = items[index];
  const prev = items[index - 1];
  const next = items[index + 1];
  const isDone = done.has(item.id);

  async function toggleDone() {
    setSaving(true);
    try {
      await api(`/weeks/${weekId}/items/${item.id}/complete`, { method: "PUT", body: { done: !isDone } });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function completeAndNext() {
    if (MANUAL.has(item.type) && !isDone) await toggleDone();
    navigate(next ? `/weeks/${weekId}/${next.id}` : "/");
  }

  return (
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Course</Link> › Week {week.number}: {week.title}
      </nav>
      <div className="course-layout">
        <div>
          <button className="btn course-nav-toggle" aria-expanded={navOpen} aria-controls="course-nav" onClick={() => setNavOpen(!navOpen)}>
            <span>Week {week.number} outline</span>
            <span className="muted small">{done.size} of {items.length} done {navOpen ? "▴" : "▾"}</span>
          </button>
          <CourseNav id="course-nav" open={navOpen} week={week} done={done} current={item.id} />
        </div>

        <article className="card" aria-labelledby="item-title">
          <header className="item-head">
            <div className="item-type-label">{item.module.title} · {TYPE_LABEL[item.type]}</div>
            <h1 id="item-title" style={{ fontSize: "1.6rem", marginTop: 4 }}>{item.title}</h1>
          </header>

          <ItemView week={week} item={item} progress={progress} onChange={refresh} />

          <footer className="item-footer">
            {MANUAL.has(item.type) ? (
              <button className="btn" onClick={toggleDone} disabled={saving} aria-pressed={isDone}>
                {isDone ? "✓ Completed" : "Mark as completed"}
              </button>
            ) : (
              <span className="small muted">
                {isDone ? "✓ Completed" : item.type === "quiz" ? `Pass with ${week.pass_percent}% or more to complete this item.`
                  : item.type === "project" ? "Completes when you tick every step." : item.type === "voice" ? "Completes after one scored call."
                  : "Completes when you submit your answers."}
              </span>
            )}
            <div className="nav-buttons">
              {prev && <Link className="btn" to={`/weeks/${weekId}/${prev.id}`}>Previous</Link>}
              <button className="btn primary" onClick={completeAndNext}>
                {next ? (MANUAL.has(item.type) && !isDone ? "Complete and continue" : "Next") : "Back to course"}
              </button>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}

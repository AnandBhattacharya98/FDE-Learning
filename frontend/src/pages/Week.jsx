import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { MANUAL, TYPE_LABEL, flatItems } from "../components/courseItems.js";
import CourseNav from "../components/CourseNav.jsx";
import ItemView from "../components/ItemView.jsx";
import ClassMaterials from "../components/ClassMaterials.jsx";
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

  useEffect(() => { setNavOpen(false); window.scrollTo({ top: 0 }); refresh(); }, [itemId, refresh]);

  const items = useMemo(() => (week ? flatItems(week) : []), [week]);
  const done = useMemo(() => new Set(progress?.items_done || []), [progress]);

  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!week) return <p className="muted">Loading…</p>;

  // A week whose lessons aren't written yet: only what the teachers have shared.
  if (!items.length) {
    return (
      <div>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Course</Link> <span aria-hidden="true">/</span> Week {week.number}
        </nav>
        <header className="week-head page-band aura soft">
          <div>
            <span className="eyebrow">Week {week.number}</span>
            <h1 className="week-head-title">{week.title}</h1>
            <p className="muted" style={{ margin: "0 0 4px" }}>{week.goal}</p>
            <p className="small muted" style={{ margin: 0 }}>The lessons for this week are on their way. Here's what your teachers have shared so far.</p>
          </div>
        </header>
        <ClassMaterials week={week} />
      </div>
    );
  }

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
      return true;
    } catch {
      return false; // e.g. a double-click raced the first save; stay on this item
    } finally {
      setSaving(false);
    }
  }

  async function completeAndNext() {
    if (MANUAL.has(item.type) && !isDone) {
      if (!(await toggleDone())) return;
    }
    navigate(next ? `/weeks/${weekId}/${next.id}` : "/");
  }

  return (
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> Week {week.number}
      </nav>
      <header className="week-head page-band aura soft">
        <div>
          <span className="eyebrow">Week {week.number}{week.due ? ` · due ${week.due}` : ""}</span>
          <h1 className="week-head-title">{week.title}</h1>
        </div>
        <div className="week-head-progress">
          <span className="small muted">{done.size} of {items.length} done</span>
          <div className="progress-bar" role="progressbar" aria-label={`Week ${week.number} progress`} aria-valuemin={0} aria-valuemax={100}
               aria-valuenow={items.length ? Math.round((100 * done.size) / items.length) : 0}>
            <div style={{ width: `${items.length ? (100 * done.size) / items.length : 0}%` }} />
          </div>
        </div>
      </header>
      <div className="course-layout">
        <div>
          <button className="btn course-nav-toggle" aria-expanded={navOpen} aria-controls="course-nav" onClick={() => setNavOpen(!navOpen)}>
            <span>Week {week.number} outline</span>
            <span className="muted small">{done.size} of {items.length} done {navOpen ? "▴" : "▾"}</span>
          </button>
          <CourseNav id="course-nav" open={navOpen} week={week} done={done} current={item.id} />
        </div>

        <div style={{ minWidth: 0 }}>
        <article className="card" aria-labelledby="item-title">
          <header className="item-head">
            <div className="item-meta">
              <span className={`type-pill type-${item.type}`}>{TYPE_LABEL[item.type]}</span>
              <span className="item-type-label">{item.module.title}</span>
            </div>
            <h2 id="item-title" className="item-title"><span className="item-num">{item.num}</span> {item.title}</h2>
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
              <button className="btn primary" onClick={completeAndNext} disabled={saving}>
                {next ? (MANUAL.has(item.type) && !isDone ? "Complete and continue" : "Next") : "Back to course"}
              </button>
            </div>
          </footer>
        </article>
        <ClassMaterials week={week} moduleId={item.module.id} />
        </div>
      </div>
    </div>
  );
}

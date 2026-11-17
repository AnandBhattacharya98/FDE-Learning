import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import "../dictionary.css";

// The course-wide dictionary (content/glossary.json via GET /glossary): search, topic and week
// filters, and an A–Z bar that jumps to each letter.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const letterOf = (term) => (/[a-z]/i.test(term[0]) ? term[0].toUpperCase() : "#");

export default function Dictionary() {
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState("");
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");  // the coach links here with ?q=term
  const [topic, setTopic] = useState("");
  const [week, setWeek] = useState("");

  useEffect(() => { const v = params.get("q"); if (v !== null) setQ(v); }, [params]);
  useEffect(() => { api("/glossary").then((r) => setTerms(r.terms)).catch((e) => setError(e.message)); }, []);

  const topics = useMemo(() => [...new Set((terms || []).map((t) => t.topic))].sort(), [terms]);
  const weeks = useMemo(() => [...new Set((terms || []).map((t) => t.week))].sort((a, b) => a - b), [terms]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (terms || []).filter((t) => (!topic || t.topic === topic) && (!week || t.week === Number(week))
      && (!needle || t.term.toLowerCase().includes(needle) || t.meaning.toLowerCase().includes(needle)));
  }, [terms, q, topic, week]);
  const groups = useMemo(() => {
    const g = {};
    for (const t of shown) (g[letterOf(t.term)] ||= []).push(t);
    return g;
  }, [shown]);

  const jump = (l) => document.getElementById(`dict-${l}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const filtered = q || topic || week;

  return (
    <div>
      <header className="page-band aura soft dict-head">
        <span className="eyebrow">Every week</span>
        <h1>Dictionary</h1>
        <p className="muted">Every technical word in the course, in plain words.{terms && ` ${terms.length} terms.`}</p>
      </header>

      <div className="dict-tools">
        <input type="search" placeholder="Search a word or its meaning…" aria-label="Search the dictionary"
               value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="dict-filters" role="group" aria-label="Filter by topic">
          <button type="button" className={`dict-chip${!topic ? " on" : ""}`} aria-pressed={!topic} onClick={() => setTopic("")}>All topics</button>
          {topics.map((t) => (
            <button key={t} type="button" className={`dict-chip${topic === t ? " on" : ""}`} aria-pressed={topic === t}
                    onClick={() => setTopic(topic === t ? "" : t)}>{t}</button>
          ))}
          <select aria-label="Filter by week" value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="">All weeks</option>
            {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <nav className="dict-az" aria-label="Jump to letter">
          {LETTERS.map((l) => (
            <button key={l} type="button" disabled={!groups[l]} onClick={() => jump(l)}>{l}</button>
          ))}
        </nav>
      </div>

      {error && <p className="notice error">{error}</p>}
      {!terms && !error && <p className="muted">Loading…</p>}
      {terms && (
        <p className="small muted" aria-live="polite">
          {filtered ? `${shown.length} of ${terms.length} terms` : `${terms.length} terms, A–Z`}
          {filtered && <> · <button type="button" className="btn link" onClick={() => { setQ(""); setTopic(""); setWeek(""); }}>Clear filters</button></>}
        </p>
      )}
      {terms && shown.length === 0 && <p className="muted">No word matches. Try fewer letters or clear the filters.</p>}

      {LETTERS.filter((l) => groups[l]).map((l) => (
        <section key={l} id={`dict-${l}`} className="dict-letter" aria-labelledby={`dict-h-${l}`}>
          <h2 id={`dict-h-${l}`}>{l}</h2>
          <dl>
            {groups[l].map((t) => (
              <div key={t.term} className="dict-entry">
                <dt>{t.term}</dt>
                <dd>
                  {t.meaning}
                  <span className="dict-meta">
                    {t.topic} · Week {t.week} · <Link to={t.link}>Read the lesson: {t.lesson_title} →</Link>
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";

function when(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function ScoreRing({ score, total }) {
  const pct = total ? score / total : 0;
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg className="score-ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${score} of ${total}`}>
      <circle cx="38" cy="38" r={r} className="score-ring-track" />
      <circle cx="38" cy="38" r={r} className="score-ring-fill" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle">{score}/{total}</text>
    </svg>
  );
}

// lessonFor maps a concept id to the course item that teaches it, so a weak topic links to its lesson.
export function Scorecard({ card, week, lessonFor }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const weak = card.questions.filter((q) => q.correct === false);
  return (
    <section className="card scorecard" aria-label="Voice quiz scorecard">
      <div className="scorecard-head">
        {card.complete ? <ScoreRing score={card.score} total={card.total} /> : <div className="score-ring-empty" aria-hidden>…</div>}
        <div>
          <span className="eyebrow">Scorecard · {when(card.created_at)}</span>
          <h3 style={{ margin: "8px 0 4px" }}>
            {!card.complete ? "Call ended before scoring"
              : card.score === card.total ? "Every answer landed"
              : `${card.score} of ${card.total} answers landed`}
          </h3>
          <p className="small muted" style={{ margin: 0 }}>
            {card.complete ? "Scored by the voice coach. Only scored calls count for the leaderboard."
              : "You hung up before the last question, so this call isn't scored. The transcript is below."}
          </p>
        </div>
      </div>

      {card.complete && (
        <div className="weak-topics">
          <strong className="small">Topics to review</strong>
          {weak.length === 0 ? <span className="small muted"> Nothing, nice work.</span> : (
            <ul className="chip-row">
              {weak.map((q) => {
                const item = lessonFor(q.concept);
                return (
                  <li key={q.id}>
                    {item ? <Link className="topic-chip" to={`/weeks/${week.id}/${item}`}>{q.concept_title}</Link>
                      : <span className="topic-chip">{q.concept_title}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <ol className="scorecard-questions">
        {card.questions.map((q) => (
          <li key={q.id} className={q.correct === true ? "ok" : q.correct === false ? "bad" : "unscored"}>
            <span className="q-mark" aria-label={q.correct === true ? "Correct" : q.correct === false ? "Missed" : "Not scored"}>
              {q.correct === true ? "✓" : q.correct === false ? "✕" : "–"}
            </span>
            <div>
              <div>{q.prompt}</div>
              {q.note && <div className="small muted">{q.note}</div>}
              {q.missed.length > 0 && (
                <div className="small"><span className="muted">You missed: </span>{q.missed.join("; ")}</div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {card.transcript.length > 0 && (
        <>
          <button className="btn link small" onClick={() => setShowTranscript((s) => !s)} aria-expanded={showTranscript}>
            {showTranscript ? "Hide the transcript" : `Show the transcript (${card.transcript.length} turns)`}
          </button>
          {showTranscript && (
            <div className="transcript">
              {card.transcript.map((t, i) => (
                <div key={i} className={`turn ${t.role}`}>
                  <span className="turn-who">{t.role === "coach" ? "Coach" : "You"}</span>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Leaderboard({ entries, scope, onScope, weekTitle }) {
  return (
    <section className="card leaderboard">
      <div className="leaderboard-head">
        <h3 style={{ margin: 0 }}>Leaderboard</h3>
        <div className="seg" role="group" aria-label="Leaderboard scope">
          <button className={scope === "week" ? "on" : ""} aria-pressed={scope === "week"} onClick={() => onScope("week")}>{weekTitle}</button>
          <button className={scope === "course" ? "on" : ""} aria-pressed={scope === "course"} onClick={() => onScope("course")}>Whole course</button>
        </div>
      </div>
      <p className="small muted">Everyone's best scored voice call{scope === "course" ? " in each week, added up" : ""}.</p>
      {entries === null ? <p className="small muted">Loading…</p> : entries.length === 0 ? (
        <p className="small muted">No scored calls yet. Be the first.</p>
      ) : (
        <ol className="board">
          {entries.map((e) => (
            <li key={e.rank} className={e.you ? "you" : ""}>
              <span className="board-rank">{e.rank}</span>
              <span className="board-name">{e.name}{e.you && <span className="small muted"> (you)</span>}</span>
              <span className="board-score">{e.score}/{e.total}</span>
              <span className="board-bar" aria-hidden><span style={{ width: `${e.percent}%` }} /></span>
              <span className="small muted board-calls">{e.calls} {e.calls === 1 ? "call" : "calls"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

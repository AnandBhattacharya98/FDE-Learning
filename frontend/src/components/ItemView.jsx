import Illustration from "./Illustration.jsx";
import Projects from "./Projects.jsx";
import Quiz from "./Quiz.jsx";
import VoiceQuiz from "./VoiceQuiz.jsx";
import { TYPE_LABEL } from "./courseItems.js";

function Overview({ week }) {
  const quiz = week.modules.flatMap((m) => m.items).find((i) => i.type === "quiz");
  return (
    <div className="lesson-body">
      <p style={{ fontSize: "1.1rem" }}>{week.goal}</p>
      <h3>What you'll learn</h3>
      <ul>{week.learn.map((l) => <li key={l}>{l}</li>)}</ul>
      <h3 style={{ marginTop: 20 }}>This week's modules</h3>
      <ol>
        {week.modules.slice(1).map((m) => (
          <li key={m.id}><strong>{m.title}.</strong> {m.summary}</li>
        ))}
      </ol>
      <h3 style={{ marginTop: 20 }}>How you're assessed</h3>
      <ul>
        {quiz && <li><strong>Graded quiz:</strong> {quiz.refs.length} questions. Pass with {week.pass_percent}% or more; retake as often as you like.</li>}
        {week.projects.map((p) => <li key={p.id}><strong>Assignment {p.id}:</strong> {p.title}. Done when: {p.done_when}</li>)}
        <li><strong>Voice quiz:</strong> explain the ideas out loud to a voice coach, the way you would to a client.</li>
      </ul>
      <p className="notice warn" style={{ marginTop: 16 }}><strong>Due {week.due}.</strong> {week.kickoff}.</p>
    </div>
  );
}

function Lesson({ week, item }) {
  const c = week.concepts.find((x) => x.id === item.ref);
  const brief = week.illustrations.find((i) => i.id === c.illustration);
  return (
    <div className="lesson-body">
      {c.illustration && <Illustration id={c.illustration} brief={brief} />}
      <p style={{ fontSize: "1.1rem" }}><strong>{c.summary}</strong></p>
      <ul>{c.body.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </div>
  );
}

function Reading({ week, item }) {
  const g = week.resources.find((r) => r.group === item.ref);
  return (
    <div>
      <p className="muted">Work through these before moving on. Links open in a new tab.</p>
      <ul style={{ paddingLeft: "1.1rem" }}>
        {g.items.map((r) => (
          <li key={r.title} style={{ marginBottom: 10 }}>
            {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : <span>{r.title}</span>}
            {r.note && <div className="small muted">{r.note}</div>}
            {!r.url && !r.note.startsWith("Internal") && <div className="small muted">Link coming soon.</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ItemView({ week, item, progress, onChange }) {
  switch (item.type) {
    case "overview": return <Overview week={week} />;
    case "lesson": return <Lesson week={week} item={item} />;
    case "reading": return <Reading week={week} item={item} />;
    case "practice":
    case "quiz": return <Quiz key={item.id} week={week} item={item} onDone={onChange} />;
    case "project": return <Projects week={week} only={item.ref} progress={progress} onChange={onChange} />;
    case "voice": return <VoiceQuiz week={week} progress={progress} />;
    default: return <p>{TYPE_LABEL[item.type] || item.type}</p>;
  }
}

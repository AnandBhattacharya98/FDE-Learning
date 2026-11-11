import Illustration from "./Illustration.jsx";

export default function Concepts({ week }) {
  const parts = [];
  for (const c of week.concepts) {
    const last = parts[parts.length - 1];
    if (last && last.part === c.part) last.items.push(c);
    else parts.push({ part: c.part, items: [c] });
  }
  const briefs = Object.fromEntries(week.illustrations.map((i) => [i.id, i]));

  return (
    <div>
      {week.pace?.length > 0 && (
        <div className="grid" style={{ marginBottom: 8 }}>
          {week.pace.map((p) => (
            <div key={p.week} className="card">
              <span className="pill">Week {p.week} · suggested pace</span>
              <h3 style={{ marginTop: 8 }}>{p.focus}</h3>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {parts.map(({ part, items }) => (
        <section key={part} aria-labelledby={`part-${part}`}>
          <h2 id={`part-${part}`} className="part-heading">{part}</h2>
          <div className="grid">
            {items.map((c) => (
              <article key={c.id} className="card concept" id={c.id}>
                <h3>{c.title}</h3>
                {c.illustration && <Illustration id={c.illustration} brief={briefs[c.illustration]} />}
                <p><strong>{c.summary}</strong></p>
                <ul>{c.body.map((line, i) => <li key={i}>{line}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

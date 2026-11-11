export default function Resources({ week }) {
  return (
    <div className="grid">
      {week.resources.map((g) => (
        <section key={g.group} className="card">
          <h2>{g.group}</h2>
          <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
            {g.items.map((r) => (
              <li key={r.title} style={{ marginBottom: 8 }}>
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : <span>{r.title}</span>}
                {r.note && <div className="small muted">{r.note}</div>}
                {!r.url && !r.note.startsWith("Internal") && <div className="small muted">Link coming soon.</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Hand-drawn SVG diagrams, keyed by the illustration ids in content/*.json.
// Colours come from CSS variables so each diagram works in light and dark mode.

const box = { fill: "var(--surface)", stroke: "var(--border)", strokeWidth: 1.5 };
const label = { fill: "var(--text)", fontFamily: "var(--font)", fontSize: 14, fontWeight: 600, textAnchor: "middle" };
const sub = { fill: "var(--muted)", fontFamily: "var(--font)", fontSize: 12, textAnchor: "middle" };
const arrow = { stroke: "var(--accent)", strokeWidth: 2, fill: "none", markerEnd: "url(#arrowhead)" };

function Defs() {
  return (
    <defs>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
      </marker>
    </defs>
  );
}

function RestaurantAnalogy({ title }) {
  const parts = [
    ["Dining room", "Frontend", "what you see"],
    ["Waiter", "API", "carries requests"],
    ["Kitchen", "Backend", "does the work"],
    ["Pantry", "Database", "keeps the data"],
  ];
  return (
    <svg viewBox="0 0 640 170" role="img" aria-label={title}>
      <title>{title}</title>
      <Defs />
      {parts.map(([room, part, what], i) => {
        const x = 10 + i * 160;
        return (
          <g key={room}>
            <rect x={x} y={20} width={140} height={100} rx={12} {...box} />
            <text x={x + 70} y={55} {...label}>{room}</text>
            <text x={x + 70} y={80} {...label} style={{ fill: "var(--accent)" }}>= {part}</text>
            <text x={x + 70} y={102} {...sub}>{what}</text>
            {i < 3 && <path d={`M${x + 142} 60 L${x + 158} 60`} {...arrow} />}
            {i < 3 && <path d={`M${x + 158} 85 L${x + 142} 85`} {...arrow} />}
          </g>
        );
      })}
      <text x={320} y={150} {...sub}>Order goes in → the dish comes back. The dining room never walks into the pantry.</text>
    </svg>
  );
}

function VoiceLoop({ title }) {
  const steps = [
    { x: 20, name: "Caller", what: "“I want a loan…”" },
    { x: 180, name: "1 · Ears", what: "Speech-to-text" },
    { x: 340, name: "2 · Brain", what: "LLM + prompt" },
    { x: 500, name: "3 · Mouth", what: "Text-to-speech" },
  ];
  return (
    <svg viewBox="0 0 640 190" role="img" aria-label={title}>
      <title>{title}</title>
      <Defs />
      {steps.map((s, i) => (
        <g key={s.name}>
          <rect x={s.x} y={30} width={120} height={70} rx={12} {...box} />
          <text x={s.x + 60} y={60} {...label}>{s.name}</text>
          <text x={s.x + 60} y={82} {...sub}>{s.what}</text>
          {i < 3 && <path d={`M${s.x + 122} 65 L${s.x + 158} 65`} {...arrow} />}
        </g>
      ))}
      <path d="M560 102 C560 160, 80 160, 80 104" {...arrow} />
      <text x={320} y={178} {...sub}>4 · The reply plays back, and the loop starts again. Every step adds delay.</text>
    </svg>
  );
}

export const ILLUSTRATIONS = {
  "restaurant-analogy": RestaurantAnalogy,
  "voice-loop": VoiceLoop,
};

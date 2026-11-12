// The remaining week 1–2 diagrams. Each is a plain SVG drawn from its brief in content/*.json.
// Colours come from CSS variables, so every diagram works in light and dark mode.

const FONT = "var(--font)";
const MONO = "var(--mono)";

function Defs() {
  return (
    <defs>
      <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
      </marker>
      <marker id="dg-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
      </marker>
    </defs>
  );
}

function Svg({ title, h, children }) {
  return (
    <svg viewBox={`0 0 640 ${h}`} role="img" aria-label={title}>
      <title>{title}</title>
      <Defs />
      {children}
    </svg>
  );
}

function T({ x, y, children, size = 13, weight = 400, color = "var(--text)", anchor = "middle", mono = false }) {
  return (
    <text x={x} y={y} fill={color} fontFamily={mono ? MONO : FONT} fontSize={size} fontWeight={weight} textAnchor={anchor}>
      {children}
    </text>
  );
}

function Box({ x, y, w, h, title, sub, sub2, fill = "var(--surface)", stroke = "var(--border)", titleColor = "var(--text)" }) {
  const cy = y + h / 2 + (sub ? (sub2 ? -12 : -4) : 5);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={1.5} />
      {title && <T x={x + w / 2} y={cy} size={14} weight={600} color={titleColor}>{title}</T>}
      {sub && <T x={x + w / 2} y={cy + 18} size={12} color="var(--muted)">{sub}</T>}
      {sub2 && <T x={x + w / 2} y={cy + 34} size={12} color="var(--muted)">{sub2}</T>}
    </g>
  );
}

function Arrow({ d, muted = false, dashed = false, both = false }) {
  return (
    <path d={d} fill="none" stroke={muted ? "var(--muted)" : "var(--accent)"} strokeWidth={2}
      strokeDasharray={dashed ? "5 4" : undefined}
      markerEnd={`url(#${muted ? "dg-arrow-muted" : "dg-arrow"})`}
      markerStart={both ? `url(#${muted ? "dg-arrow-muted" : "dg-arrow"})` : undefined} />
  );
}

function Bar({ x, y, w, h = 26, label, fill = "var(--accent)", text = "var(--accent-text)" }) {
  const outlined = fill === "var(--surface)";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={fill} stroke={outlined ? "var(--border)" : "none"} strokeWidth={1.5} />
      {label && <T x={x + w / 2} y={y + h / 2 + 4} size={12} weight={600} color={text}>{label}</T>}
    </g>
  );
}

/* ---------- Week 1 ---------- */

function FrontendDevices({ title }) {
  return (
    <Svg title={title} h={220}>
      {/* browser */}
      <rect x={20} y={20} width={330} height={170} rx={10} fill="var(--surface)" stroke="var(--border)" strokeWidth={1.5} />
      <rect x={20} y={20} width={330} height={26} rx={10} fill="var(--surface-2)" />
      {[36, 50, 64].map((cx) => <circle key={cx} cx={cx} cy={33} r={4} fill="var(--border)" />)}
      <T x={200} y={37} size={11} color="var(--muted)" mono>my-call-log.vercel.app</T>
      {["Asha · Wants a loan", "Ravi · Interest rates", "Meera · Call back"].map((s, i) => (
        <g key={s}><rect x={40} y={60 + i * 32} width={290} height={24} rx={5} fill="var(--surface-2)" /><T x={52} y={76 + i * 32} anchor="start" size={12}>{s}</T></g>
      ))}
      <T x={185} y={182} size={12} color="var(--muted)">Web: React in the browser</T>
      {/* phone */}
      <rect x={390} y={14} width={110} height={190} rx={16} fill="var(--surface)" stroke="var(--border)" strokeWidth={1.5} />
      {["Asha", "Ravi", "Meera"].map((s, i) => (
        <g key={s}><rect x={402} y={42 + i * 30} width={86} height={22} rx={5} fill="var(--surface-2)" /><T x={412} y={57 + i * 30} anchor="start" size={12}>{s}</T></g>
      ))}
      <T x={445} y={190} size={12} color="var(--muted)">Mobile app</T>
      {/* key warning */}
      <g transform="translate(520 60)">
        <rect x={0} y={0} width={110} height={100} rx={10} fill="var(--bad-bg)" />
        <circle cx={40} cy={34} r={10} fill="none" stroke="var(--bad)" strokeWidth={3} />
        <path d="M50 34 H78 M70 34 V44 M62 34 V42" stroke="var(--bad)" strokeWidth={3} fill="none" />
        <path d="M22 14 L88 58" stroke="var(--bad)" strokeWidth={3} />
        <T x={55} y={78} size={12} weight={600} color="var(--bad)">No keys in</T>
        <T x={55} y={93} size={12} weight={600} color="var(--bad)">the frontend</T>
      </g>
    </Svg>
  );
}

function BackendFourSteps({ title }) {
  const steps = [["1 · Is it allowed?", "API key check"], ["2 · Is it valid?", "has what it needs"], ["3 · Do the work", "database or LLM"], ["4 · Reply", "status + JSON"]];
  return (
    <Svg title={title} h={170}>
      <T x={30} y={30} anchor="start" size={12} color="var(--muted)" mono>GET /calls</T>
      <Arrow d="M30 40 L30 70 L38 70" />
      {steps.map(([t, s], i) => (
        <g key={t}>
          <Box x={40 + i * 150} y={50} w={130} h={64} title={t} sub={s} />
          {i < 3 && <Arrow d={`M${172 + i * 150} 82 L${188 + i * 150} 82`} />}
        </g>
      ))}
      <Arrow d="M600 116 L600 140 L520 140" />
      <T x={470} y={145} size={12} color="var(--muted)" mono>200 OK</T>
      <T x={250} y={150} size={12} color="var(--muted)">A failed check stops early: 401 or 400.</T>
    </Svg>
  );
}

function CallsTable({ title }) {
  const cols = [["id", 50], ["caller", 110], ["summary", 230], ["created_at", 130]];
  const rows = [["1", "Asha", "Wants a loan for her shop", "10 Nov, 10:42"], ["2", "Ravi", "Asked about interest rates", "10 Nov, 11:05"], ["3", "Meera", "Call back next week", "10 Nov, 11:30"], ["4", "Imran", "Not interested", "10 Nov, 12:15"]];
  let x0 = 20;
  const xs = cols.map(([, w]) => { const x = x0; x0 += w; return x; });
  return (
    <Svg title={title} h={250}>
      <rect x={20} y={20} width={520} height={30} fill="var(--surface-2)" />
      {cols.map(([c], i) => <T key={c} x={xs[i] + 10} y={40} anchor="start" size={12} weight={600} mono>{c}</T>)}
      {rows.map((r, ri) => (
        <g key={ri}>
          <rect x={20} y={50 + ri * 30} width={520} height={30} fill={ri === 0 ? "var(--ok-bg)" : "var(--surface)"} stroke="var(--border)" />
          {r.map((v, i) => <T key={i} x={xs[i] + 10} y={70 + ri * 30} anchor="start" size={12}>{v}</T>)}
        </g>
      ))}
      <T x={550} y={70} anchor="start" size={12} color="var(--ok)" weight={600}>← one row</T>
      <T x={550} y={86} anchor="start" size={12} color="var(--ok)" weight={600}>= one call</T>
      <T x={180} y={190} size={12} color="var(--muted)">each column is one detail</T>
      <rect x={20} y={205} width={300} height={38} rx={8} fill="var(--surface-2)" />
      <T x={30} y={221} anchor="start" size={11} mono>GET /calls → SELECT caller, summary</T>
      <T x={30} y={236} anchor="start" size={11} mono>POST /calls → INSERT INTO calls …</T>
      <T x={430} y={228} size={12} color="var(--muted)">Only the backend talks to it.</T>
    </Svg>
  );
}

function RequestAnatomy({ title }) {
  const req = [["Method", "POST"], ["Address", "…onrender.com/calls"], ["Headers", "Content-Type: json"], ["Body", '{"caller": "Asha"}']];
  const rep = [["Status", "201 Created"], ["Body", '{"id": 7, "caller": …}']];
  return (
    <Svg title={title} h={230}>
      <T x={150} y={22} size={13} weight={700}>The request · what you send</T>
      {req.map(([k, v], i) => (
        <g key={k}>
          <rect x={20} y={34 + i * 44} width={260} height={36} rx={8} fill="var(--surface)" stroke="var(--border)" strokeWidth={1.5} />
          <T x={32} y={56 + i * 44} anchor="start" size={12} weight={600}>{k}</T>
          <T x={268} y={56 + i * 44} anchor="end" size={11} mono color="var(--accent)">{v}</T>
        </g>
      ))}
      <Arrow d="M290 110 L350 110" />
      <T x={490} y={22} size={13} weight={700}>The reply · what comes back</T>
      {rep.map(([k, v], i) => (
        <g key={k}>
          <rect x={360} y={56 + i * 44} width={260} height={36} rx={8} fill={i === 0 ? "var(--ok-bg)" : "var(--surface)"} stroke="var(--border)" strokeWidth={1.5} />
          <T x={372} y={78 + i * 44} anchor="start" size={12} weight={600}>{k}</T>
          <T x={608} y={78 + i * 44} anchor="end" size={11} mono color={i === 0 ? "var(--ok)" : "var(--accent)"}>{v}</T>
        </g>
      ))}
      <T x={490} y={170} size={12} color="var(--muted)">The saved call, with its new id.</T>
    </Svg>
  );
}

function StatusCodes({ title }) {
  const bands = [
    ["2xx", "It worked", "200 OK · 201 Created", "var(--ok-bg)", "var(--ok)"],
    ["4xx", "Fix your request", "400 · 401 key · 404 address", "var(--warn-bg)", "var(--warn-text)"],
    ["5xx", "The server's problem", "500 Server Error", "var(--bad-bg)", "var(--bad)"],
  ];
  return (
    <Svg title={title} h={180}>
      {bands.map(([code, meaning, ex, bg, fg], i) => (
        <g key={code}>
          <rect x={20} y={14 + i * 54} width={600} height={46} rx={10} fill={bg} />
          <T x={60} y={44 + i * 54} size={20} weight={700} color={fg} mono>{code}</T>
          <T x={120} y={43 + i * 54} anchor="start" size={15} weight={600} color={fg}>{meaning}</T>
          <T x={600} y={43 + i * 54} anchor="end" size={12} color={fg} mono>{ex}</T>
        </g>
      ))}
    </Svg>
  );
}

function ThreeWays({ title }) {
  const ways = [["Browser", "GET only"], ["Postman", "fill in a form"], ["curl", "one command"]];
  return (
    <Svg title={title} h={212}>
      {ways.map(([t, s], i) => (
        <g key={t}>
          <Box x={20} y={14 + i * 60} w={170} h={48} title={t} sub={s} />
          <Arrow d={`M192 ${38 + i * 60} C 300 ${38 + i * 60}, 330 100, 420 100`} muted={i === 0} />
        </g>
      ))}
      <Box x={424} y={70} w={196} h={60} title="Your API" sub="same request, same reply" />
      <T x={320} y={204} size={11} mono color="var(--muted)">curl -X POST …/calls -H "Content-Type: application/json" -d '{"…"}'</T>
    </Svg>
  );
}

function RoundTrip({ title }) {
  const lanes = [["Frontend", "React on Vercel", 90], ["Backend", "Python API on Render", 320], ["Database", "Postgres on Neon", 550]];
  const steps = [
    [1, 90, 90, "You open the page"],
    [2, 90, 320, "GET /calls"],
    [3, 320, 550, "SELECT * FROM calls"],
    [4, 550, 320, "the matching rows"],
    [5, 320, 90, "200 OK + JSON"],
    [6, 90, 90, "The list appears"],
  ];
  return (
    <Svg title={title} h={330}>
      {lanes.map(([t, s, x]) => (
        <g key={t}>
          <Box x={x - 85} y={10} w={170} h={50} title={t} sub={s} />
          <path d={`M${x} 62 L${x} 320`} stroke="var(--border)" strokeWidth={1.5} strokeDasharray="4 4" />
        </g>
      ))}
      {steps.map(([n, from, to, label], i) => {
        const y = 92 + i * 40;
        return (
          <g key={n}>
            {from === to ? (
              <circle cx={from} cy={y} r={5} fill="var(--accent)" />
            ) : (
              <Arrow d={`M${from + (to > from ? 6 : -6)} ${y} L${to + (to > from ? -8 : 8)} ${y}`} muted={to < from} />
            )}
            <circle cx={from === to ? from - 26 : Math.min(from, to) + 18} cy={y - 12} r={9} fill="var(--accent)" />
            <T x={from === to ? from - 26 : Math.min(from, to) + 18} y={y - 8} size={11} weight={700} color="var(--accent-text)">{n}</T>
            <T x={from === to ? from + 14 : (from + to) / 2} y={y - 8} anchor={from === to ? "start" : "middle"} size={12} mono={n >= 2 && n <= 5}>{label}</T>
          </g>
        );
      })}
    </Svg>
  );
}

function LocalVsDeployed({ title }) {
  return (
    <Svg title={title} h={230}>
      <Box x={20} y={50} w={170} h={110} title="Your laptop" sub="localhost:8000" sub2="only you can open it" />
      <T x={105} y={185} size={12} color="var(--muted)">Keys: in .env</T>
      <Arrow d="M192 105 L248 105" />
      <Box x={252} y={78} w={120} h={54} title="GitHub" sub="your code" />
      <Arrow d="M374 98 C 410 98, 410 40, 438 40" />
      <Arrow d="M374 105 L438 105" />
      <Arrow d="M374 112 C 410 112, 410 170, 438 170" />
      <Box x={440} y={14} w={180} h={52} title="Vercel" sub="runs the React page" />
      <Box x={440} y={79} w={180} h={52} title="Render" sub="runs the Python API" />
      <Box x={440} y={144} w={180} h={52} title="Neon" sub="runs Postgres" />
      <T x={530} y={218} size={12} color="var(--muted)">Keys: pasted into each host's settings</T>
    </Svg>
  );
}

function P1Architecture({ title }) {
  return (
    <Svg title={title} h={220}>
      <Box x={20} y={20} w={170} h={56} title="curl or Postman" sub="you add a call" />
      <Arrow d="M192 48 L262 48" />
      <T x={228} y={40} size={11} mono color="var(--muted)">POST</T>
      <Box x={266} y={20} w={180} h={110} title="Python API" sub="on Render" sub2="GET + POST /calls" />
      <Arrow d="M448 75 L492 75" both />
      <Box x={496} y={40} w={124} h={70} title="Postgres" sub="on Neon" sub2="table: calls" />
      <Box x={20} y={140} w={170} h={56} title="React page" sub="on Vercel: lists calls" />
      <Arrow d="M192 168 C 240 168, 250 120, 264 112" />
      <T x={236} y={178} size={11} mono color="var(--muted)">GET /calls</T>
      <T x={443} y={170} size={12} color="var(--muted)">Done when a curl POST shows up on the page.</T>
    </Svg>
  );
}

/* ---------- Week 2 ---------- */

function LatencyTimeline({ title }) {
  const sx = (s) => 80 + s * 260; // 0–2 s → 80–600
  return (
    <Svg title={title} h={230}>
      <T x={20} y={34} anchor="start" size={12} weight={600}>One step</T>
      <T x={20} y={50} anchor="start" size={12} weight={600}>at a time</T>
      <Bar x={sx(0)} y={26} w={sx(0.5) - sx(0)} label="STT 0.5 s" />
      <Bar x={sx(0.5)} y={26} w={sx(1.5) - sx(0.5)} label="LLM 1.0 s" />
      <Bar x={sx(1.5)} y={26} w={sx(1.9) - sx(1.5)} label="TTS 0.4" />
      <T x={sx(1.9)} y={70} size={12} weight={600} color="var(--bad)">first word at 1.9 s</T>

      <T x={20} y={112} anchor="start" size={12} weight={600}>Streaming</T>
      <Bar x={sx(0)} y={96} w={sx(0.3) - sx(0)} h={18} label="STT" />
      <Bar x={sx(0.25)} y={118} w={sx(1.2) - sx(0.25)} h={18} label="LLM writes word by word" fill="var(--surface)" text="var(--text)" />
      <Bar x={sx(0.6)} y={140} w={sx(1.4) - sx(0.6)} h={18} label="TTS speaks as words arrive" fill="var(--ok-bg)" text="var(--ok)" />
      <path d={`M${sx(0.6)} 140 L${sx(0.6)} 166`} stroke="var(--ok)" strokeWidth={2} />
      <T x={sx(0.6) + 4} y={178} anchor="start" size={12} weight={600} color="var(--ok)">first word at ~0.6 s</T>

      <path d={`M${sx(0)} 196 L${sx(2)} 196`} stroke="var(--border)" strokeWidth={1.5} />
      {[0, 0.5, 1, 1.5, 2].map((s) => (
        <g key={s}><path d={`M${sx(s)} 192 L${sx(s)} 200`} stroke="var(--muted)" /><T x={sx(s)} y={214} size={11} color="var(--muted)">{s} s</T></g>
      ))}
      <T x={330} y={228} size={11} color="var(--muted)">Seconds after the caller stops talking. Natural: 0.4–0.8 s. Timings illustrative.</T>
    </Svg>
  );
}

function TurnTaking({ title }) {
  return (
    <Svg title={title} h={190}>
      <T x={20} y={42} anchor="start" size={12} weight={600}>Caller</T>
      <Bar x={90} y={26} w={170} label="“I want a loan…”" fill="var(--surface)" text="var(--text)" />
      <rect x={262} y={26} width={36} height={26} rx={6} fill="none" stroke="var(--muted)" strokeDasharray="3 3" />
      <Bar x={300} y={26} w={130} label="“…for my shop.”" fill="var(--surface)" text="var(--text)" />
      <rect x={432} y={26} width={80} height={26} rx={6} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />
      <T x={472} y={43} size={11} color="var(--accent)">silence timer</T>
      <T x={280} y={72} size={11} color="var(--muted)">short pause:</T>
      <T x={280} y={86} size={11} color="var(--muted)">keeps listening</T>
      <T x={472} y={72} size={11} color="var(--accent)">timer runs out:</T>
      <T x={472} y={86} size={11} color="var(--accent)">agent replies</T>
      <T x={20} y={116} anchor="start" size={12} weight={600}>Agent</T>
      <Bar x={490} y={100} w={140} label="“Sure! How much?”" />
      <g>
        {[["Too short", "cuts the caller off", 20], ["Too long", "every reply starts late", 230], ["Smart detection", "“for my…” isn't finished", 440]].map(([t, s, x]) => (
          <Box key={t} x={x} y={136} w={180} h={46} title={t} sub={s} />
        ))}
      </g>
    </Svg>
  );
}

function Interruptions({ title }) {
  return (
    <Svg title={title} h={200}>
      <T x={20} y={42} anchor="start" size={12} weight={600}>Agent</T>
      <Bar x={90} y={26} w={250} label="“We have three loan options. The first…”" />
      <rect x={342} y={26} width={70} height={26} rx={6} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />
      <T x={377} y={43} size={11} color="var(--accent)">stops</T>
      <Bar x={414} y={26} w={180} label="listens, then answers" fill="var(--surface)" text="var(--text)" />
      <T x={20} y={92} anchor="start" size={12} weight={600}>Caller</T>
      <Bar x={300} y={76} w={190} label="“Wait, what's the interest?”" fill="var(--ok-bg)" text="var(--ok)" />
      <Arrow d="M320 74 L338 56" />
      {[["Barge-in", "stop the moment the", "caller talks", 20], ["False alarm", "a cough, TV or traffic", "looks like speech", 230], ["Echo", "the agent's own voice", "leaks back into the mic", 440]].map(([t, s, s2, x]) => (
        <Box key={t} x={x} y={122} w={180} h={66} title={t} sub={s} sub2={s2} />
      ))}
    </Svg>
  );
}

function LiveKitRoom({ title }) {
  return (
    <Svg title={title} h={240}>
      <circle cx={300} cy={120} r={78} fill="var(--surface-2)" stroke="var(--accent)" strokeWidth={2} />
      <T x={300} y={115} size={14} weight={700}>LiveKit room</T>
      <T x={300} y={133} size={12} color="var(--muted)">a live audio call</T>
      <Box x={20} y={30} w={150} h={52} title="Browser" sub="you, in P2" />
      <Arrow d="M172 60 L232 82" both />
      <Box x={20} y={160} w={150} h={52} title="Phone" sub="via SIP, week 3" />
      <Arrow d="M172 184 L232 160" both muted dashed />
      <Box x={410} y={90} w={210} h={60} title="Your agent program" sub="joins like a participant" />
      <Arrow d="M380 120 L408 120" both />
      <Box x={430} y={180} w={170} h={50} title="STT · LLM · TTS" sub="AI services online" fill="var(--surface-2)" />
      <Arrow d="M515 152 L515 178" both muted />
    </Svg>
  );
}

function SettingsOnTheCall({ title }) {
  const stages = [
    ["Before", ["Pre-call", "processing"]],
    ["Hear", ["Speech: STT,", "turns, noise"]],
    ["Think", ["LLM, knowledge", "base, functions"]],
    ["Speak", ["Voice,", "Pronunciation"]],
    ["After", ["Post-call", "processing"]],
  ];
  return (
    <Svg title={title} h={200}>
      <Arrow d="M20 40 L620 40" muted />
      {stages.map(([s, tabs], i) => {
        const x = 20 + i * 122;
        return (
          <g key={s}>
            <circle cx={x + 55} cy={40} r={7} fill="var(--accent)" />
            <T x={x + 55} y={24} size={13} weight={700}>{s}</T>
            <rect x={x} y={60} width={110} height={56} rx={10} fill="var(--surface)" stroke="var(--border)" strokeWidth={1.5} />
            <T x={x + 55} y={84} size={12}>{tabs[0]}</T>
            <T x={x + 55} y={100} size={12}>{tabs[1]}</T>
          </g>
        );
      })}
      <rect x={20} y={134} width={600} height={40} rx={10} fill="var(--warn-bg)" />
      <T x={320} y={159} size={13} weight={600} color="var(--warn-text)">Fallbacks: the backup plan across every step</T>
    </Svg>
  );
}

function WebhookPreview({ title }) {
  const row = (y, label, a, as, b, bs, color) => (
    <g>
      <T x={20} y={y - 10} anchor="start" size={12} weight={700} color={color}>{label}</T>
      <Box x={20} y={y} w={170} h={54} title={a} sub={as} />
      <Arrow d={`M192 ${y + 27} L446 ${y + 27}`} />
      <T x={319} y={y + 18} size={12} weight={600}>webhook</T>
      <T x={319} y={y + 46} size={11} color="var(--muted)">signed with a shared secret</T>
      <Box x={450} y={y} w={170} h={54} title={b} sub={bs} />
    </g>
  );
  return (
    <Svg title={title} h={200}>
      {row(30, "Your practice · week 3 (P3)", "P2 voice bot", "a call ends", "P1 call-log app", "saves and shows it", "var(--accent)")}
      {row(125, "Real client work · every day", "RevRag agent", "a campaign call ends", "Client's CRM", "saves the outcome", "var(--ok)")}
    </Svg>
  );
}

function P2Architecture({ title }) {
  return (
    <Svg title={title} h={190}>
      <Box x={20} y={50} w={150} h={70} title="You" sub="talking in the" sub2="browser" />
      <Arrow d="M172 85 L222 85" both />
      <Box x={226} y={40} w={170} h={90} title="LiveKit Cloud room" sub="free account" sub2="the live call" />
      <Arrow d="M398 85 L448 85" both />
      <Box x={452} y={30} w={168} h={110} title="Your agent" sub="Python quickstart" sub2="STT → LLM → TTS" />
      <T x={536} y={128} size={11} color="var(--accent)">+ your prompt</T>
      <T x={320} y={172} size={12} color="var(--muted)">Done when you can hold a 2-minute conversation and have notes on 3 settings.</T>
    </Svg>
  );
}

export const DIAGRAMS = {
  "frontend-devices": FrontendDevices,
  "backend-four-steps": BackendFourSteps,
  "calls-table": CallsTable,
  "request-anatomy": RequestAnatomy,
  "status-codes": StatusCodes,
  "three-ways": ThreeWays,
  "round-trip": RoundTrip,
  "local-vs-deployed": LocalVsDeployed,
  "p1-architecture": P1Architecture,
  "latency-timeline": LatencyTimeline,
  "turn-taking": TurnTaking,
  "interruptions": Interruptions,
  "livekit-room": LiveKitRoom,
  "settings-on-the-call": SettingsOnTheCall,
  "webhook-preview": WebhookPreview,
  "p2-architecture": P2Architecture,
};

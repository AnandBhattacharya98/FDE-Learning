import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Drawer, Icon, KIND_LABEL, Seg, WeekModuleSelect, ago, fileHref, fmtSize } from "./common.jsx";

// Teacher mode: videos, slides, documents and links per week/module.
// Files go to POST /teacher/materials (multipart); long videos are added as links.

export function MaterialPreview({ m }) {
  if (m.embed_url) {
    return (
      <div className={`class-player${m.kind === "slides" ? " doc" : ""}`}>
        <iframe src={m.embed_url} title={m.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
      </div>
    );
  }
  const href = fileHref(m.file_url);
  if (href && m.content_type?.startsWith("video/")) {
    return <div className="class-player"><video src={href} controls preload="metadata" /></div>;
  }
  if (href && m.content_type === "application/pdf") {
    return <div className="class-player doc"><iframe src={href} title={m.title} loading="lazy" /></div>;
  }
  if (href && m.content_type?.startsWith("image/")) {
    return <img src={href} alt={m.title} style={{ maxWidth: "100%", borderRadius: 12, marginTop: 12 }} />;
  }
  return null;
}

function AddForm({ weeks, weekId, setWeekId, maxMb, onAdded }) {
  const [moduleId, setModuleId] = useState("");
  const [mode, setMode] = useState("file");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const formRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("week_id", weekId);
    fd.set("module_id", moduleId);
    fd.set("published", fd.get("published") ? "true" : "false");
    if (mode === "link") fd.delete("file");
    const file = fd.get("file");
    if (file && file.size > maxMb * 1024 * 1024) {
      setErr(`That file is over ${maxMb} MB. Upload long videos to YouTube (unlisted), Loom, Vimeo or Drive and add the link.`);
      return;
    }
    if (file && !file.size) fd.delete("file");
    setBusy(true); setErr("");
    try {
      await api("/teacher/materials", { method: "POST", form: fd });
      formRef.current?.reset();
      onAdded();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <form ref={formRef} className="tc-card tc-form" onSubmit={submit} aria-labelledby="add-mat">
      <div>
        <h2 id="add-mat">Add material</h2>
        <p className="muted small" style={{ margin: 0 }}>Slides and documents become quiz sources automatically. For a video, paste its transcript or your notes so Claude can write questions from it.</p>
      </div>
      <WeekModuleSelect weeks={weeks} weekId={weekId} moduleId={moduleId} onWeek={(w) => { setWeekId(w); setModuleId(""); }} onModule={setModuleId} idPrefix="mat" />
      <div>
        <label htmlFor="mat-title">Title</label>
        <input id="mat-title" name="title" type="text" required maxLength={200} placeholder="Kickoff recording, Webhooks deck…" />
      </div>
      <Seg label="Upload a file or add a link" value={mode} onChange={setMode} options={[["file", "Upload a file"], ["link", "Add a link"]]} />
      {mode === "file" ? (
        <div>
          <label htmlFor="mat-file">File</label>
          <input id="mat-file" name="file" type="file" required accept=".pdf,.pptx,.txt,.md,.vtt,.srt,.mp4,.webm,.mov,.m4v,.png,.jpg,.jpeg" />
          <p className="tc-hint">PDF, PowerPoint (.pptx), text, subtitles, images or a short video. Up to {maxMb} MB.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="mat-url">Link</label>
          <input id="mat-url" name="url" type="url" required placeholder="https://youtu.be/… or a Loom, Vimeo, Drive or Slides link" />
          <p className="tc-hint">YouTube, Loom, Vimeo, Google Drive and Google Slides links play inside the course.</p>
        </div>
      )}
      <div className="tc-row2">
        <div>
          <label htmlFor="mat-kind">Type</label>
          <select id="mat-kind" name="kind" className="tc-select" defaultValue="">
            <option value="">Work it out</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: "end" }}>
          <label className="tc-check"><input type="checkbox" name="published" /> Publish to learners now</label>
        </div>
      </div>
      <div>
        <label htmlFor="mat-desc">Description <span className="muted small">(learners see this)</span></label>
        <textarea id="mat-desc" name="description" maxLength={4000} rows={2} />
      </div>
      <div>
        <label htmlFor="mat-notes">Transcript or notes for quizzes <span className="muted small">(teachers only)</span></label>
        <textarea id="mat-notes" name="notes" rows={3} placeholder="Paste a video transcript, or the key points you want tested." />
      </div>
      {err && <p className="notice error" role="alert">{err}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Uploading…" : "Add material"}</button>
    </form>
  );
}

function Editor({ m, weeks, onClose, onSaved }) {
  const [f, setF] = useState({ title: m.title, description: m.description, module_id: m.module_id || "", notes: m.notes, url: m.url || "", kind: m.kind });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const week = weeks.find((w) => w.id === m.week_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(extra = {}) {
    setBusy(true); setErr("");
    try { await api(`/teacher/materials/${m.id}`, { method: "PATCH", body: { ...f, ...extra } }); onSaved(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm?.(`Delete “${m.title}”? Learners will no longer see it.`)) return;
    await api(`/teacher/materials/${m.id}`, { method: "DELETE" });
    onSaved(); onClose();
  }

  return (
    <Drawer label={`Edit ${m.title}`} onClose={onClose}>
      <span className="eyebrow">{KIND_LABEL[m.kind]} · Week {week?.number}</span>
      <h2 style={{ marginTop: 10 }}>{m.title}</h2>
      <p className="small muted">
        {m.published ? "Published" : "Draft"} · updated {ago(m.updated_at)}
        {m.file_name && ` · ${m.file_name} (${fmtSize(m.size)})`}
        {m.text_chars ? ` · ${m.text_chars.toLocaleString()} characters read from the file` : ""}
      </p>
      <MaterialPreview m={m} />
      <div className="tc-form" style={{ marginTop: 16 }}>
        <div><label htmlFor="ed-title">Title</label><input id="ed-title" type="text" value={f.title} onChange={set("title")} /></div>
        <div className="tc-row2">
          <div>
            <label htmlFor="ed-kind">Type</label>
            <select id="ed-kind" className="tc-select" value={f.kind} onChange={set("kind")}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ed-mod">Module</label>
            <select id="ed-mod" className="tc-select" value={f.module_id} onChange={set("module_id")}>
              <option value="">Whole week</option>
              {week?.modules.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </div>
        </div>
        <div><label htmlFor="ed-url">Link</label><input id="ed-url" type="url" value={f.url} onChange={set("url")} placeholder={m.file_name ? "Optional" : "https://"} /></div>
        <div><label htmlFor="ed-desc">Description</label><textarea id="ed-desc" rows={2} value={f.description} onChange={set("description")} /></div>
        <div><label htmlFor="ed-notes">Transcript or notes for quizzes</label><textarea id="ed-notes" rows={5} value={f.notes} onChange={set("notes")} /></div>
      </div>
      {err && <p className="notice error" role="alert" style={{ marginTop: 12 }}>{err}</p>}
      <div className="tc-actions">
        <button className="btn primary" disabled={busy} onClick={() => save()}>Save</button>
        <button className="btn" disabled={busy} onClick={() => save({ published: !m.published })}>{m.published ? "Unpublish" : "Save and publish"}</button>
        {m.file_url && <a className="btn ghost" href={fileHref(m.file_url)} target="_blank" rel="noreferrer">Open file</a>}
        <button className="btn ghost" onClick={remove}>Delete</button>
      </div>
    </Drawer>
  );
}

export default function Materials({ weeks, maxMb, onChange }) {
  const [weekId, setWeekId] = useState(weeks[0]?.id || "");
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api("/teacher/materials").then((r) => setItems(r.materials)).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const changed = useCallback(() => { load(); onChange?.(); }, [load, onChange]);

  const week = weeks.find((w) => w.id === weekId);
  const mods = Object.fromEntries((week?.modules || []).map((m) => [m.id, m.title]));
  const list = (items || []).filter((m) => m.week_id === weekId);
  const current = items?.find((m) => m.id === open);

  async function toggle(m, e) {
    e.stopPropagation();
    await api(`/teacher/materials/${m.id}`, { method: "PATCH", body: { published: !m.published } });
    changed();
  }

  return (
    <div className="tc-grid">
      <AddForm weeks={weeks} weekId={weekId} setWeekId={setWeekId} maxMb={maxMb} onAdded={changed} />
      <section className="tc-card" aria-labelledby="mat-list">
        <div className="tc-toolbar">
          <h2 id="mat-list" style={{ margin: 0 }}>Week {week?.number} materials</h2>
          <Seg label="Week" value={weekId} onChange={setWeekId} options={weeks.map((w) => [w.id, `Week ${w.number}`])} />
        </div>
        {err && <p className="notice error">{err}</p>}
        {!items && !err && <p className="muted">Loading…</p>}
        {items && list.length === 0 && <p className="tc-empty">Nothing here yet. Add the kickoff recording or this week's slides.</p>}
        <div className="tc-list">
          {list.map((m) => (
            <div key={m.id} className="tc-rowi">
              <button type="button" className="tc-row-main" onClick={() => setOpen(m.id)}>
                <Icon name={m.kind} />
                <span style={{ minWidth: 0 }}>
                  <span className="t">{m.title}</span>
                  <span className="s">{KIND_LABEL[m.kind]} · {m.module_id ? mods[m.module_id] : "Whole week"}{m.size ? ` · ${fmtSize(m.size)}` : ""}</span>
                </span>
              </button>
              <span className="r">
                {m.has_text ? <span className="tc-pill accent" title="Claude can write questions from this">quiz-ready</span> : <span className="tc-pill warn" title="Add a transcript or notes so Claude can use it">no text</span>}
                <button type="button" role="switch" aria-checked={m.published} className={`tc-pill tc-pill-btn ${m.published ? "ok" : ""}`}
                  onClick={(e) => toggle(m, e)} aria-label={`${m.title}: ${m.published ? "published, click to unpublish" : "draft, click to publish"}`}>
                  {m.published ? "Published" : "Draft"}
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
      {current && <Editor m={current} weeks={weeks} onClose={() => setOpen(null)} onSaved={changed} />}
    </div>
  );
}

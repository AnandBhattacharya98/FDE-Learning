import { Link } from "react-router-dom";
import { TYPE_LABEL } from "./courseItems.js";

export default function CourseNav({ id, open, week, done, current }) {
  return (
    <nav id={id} className={`course-nav${open ? " open" : ""}`} aria-label={`Week ${week.number} outline`}>
      {week.modules.map((m) => {
        const count = m.items.filter((i) => done.has(i.id)).length;
        return (
          <div key={m.id} className="module">
            <p className="module-title">{m.title} <span className="module-count">{count}/{m.items.length}</span></p>
            <ol>
              {m.items.map((i) => (
                <li key={i.id}>
                  <Link to={`/weeks/${week.id}/${i.id}`} aria-current={i.id === current ? "page" : undefined}>
                    <span className={`check${done.has(i.id) ? " done" : ""}`} aria-hidden="true" />
                    <span className="item-text">
                      <span>{i.title}</span>
                      <span className="item-type">{TYPE_LABEL[i.type]}{done.has(i.id) ? " · completed" : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </nav>
  );
}

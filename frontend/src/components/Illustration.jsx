import { ILLUSTRATIONS } from "../illustrations/index.jsx";

export default function Illustration({ id, brief }) {
  const Svg = ILLUSTRATIONS[id];
  if (Svg) {
    return <figure className="figure" style={{ margin: "4px 0 12px" }}><Svg title={brief?.title || id} /></figure>;
  }
  // Not drawn yet: show the brief so the card still teaches something.
  return (
    <figure className="figure placeholder" style={{ margin: "4px 0 12px" }}>
      <strong>Diagram coming soon:</strong> {brief?.brief || id}
    </figure>
  );
}

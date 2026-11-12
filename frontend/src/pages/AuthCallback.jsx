import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { useAuth } from "../auth.jsx";

// The API sends people here after Google sign-in with #token=...&next=/path.
export default function AuthCallback() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    const next = params.get("next") || "/";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    window.history.replaceState(null, "", window.location.pathname); // drop the token from the address bar
    if (!token) { navigate("/login", { replace: true }); return; }
    setToken(token);
    api("/me")
      .then((user) => { signIn({ token, user }); navigate(safeNext, { replace: true }); })
      .catch(() => { setToken(null); navigate("/login", { replace: true }); });
  }, [navigate, signIn]);

  return <p className="muted">Signing you in…</p>;
}

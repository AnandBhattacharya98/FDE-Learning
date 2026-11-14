export const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "") + "/api/fde";
const TOKEN_KEY = "fde.token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = "GET", body, form } = {}) {
  // form: a FormData (file uploads); the browser sets its multipart Content-Type.
  const headers = form ? {} : { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  } catch {
    throw new ApiError(0, "Can't reach the server. If it's on Render's free plan it may be waking up, so try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let message = typeof data.detail === "string" ? data.detail : "Something went wrong. Try again.";
    if (Array.isArray(data.detail)) message = data.detail.map((d) => d.msg).join(". ");
    throw new ApiError(res.status, message);
  }
  return data;
}

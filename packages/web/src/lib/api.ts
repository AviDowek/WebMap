import { API_BASE } from "./constants";

const AUTH_TOKEN_STORAGE = "webmap_auth_token";
const ANTHROPIC_KEY_STORAGE = "webmap_anthropic_key";

// ─── Auth Token (JWT) ───────────────────────────────────────────────

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(AUTH_TOKEN_STORAGE) || "";
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(AUTH_TOKEN_STORAGE, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_STORAGE);
  }
}

export function isLoggedIn(): boolean {
  return getAuthToken().length > 0;
}

export function logout(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE);
}

// ─── Anthropic API Key (BYOK) ───────────────────────────────────────

export function getAnthropicKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ANTHROPIC_KEY_STORAGE) || "";
}

export function setAnthropicKey(key: string): void {
  if (typeof window === "undefined") return;
  if (key) {
    localStorage.setItem(ANTHROPIC_KEY_STORAGE, key);
  } else {
    localStorage.removeItem(ANTHROPIC_KEY_STORAGE);
  }
}

export function hasAnthropicKey(): boolean {
  return getAnthropicKey().length > 0;
}

// ─── Headers ────────────────────────────────────────────────────────

/** Build standard headers for API requests (JWT auth + BYOK Anthropic key) */
export function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  const anthropicKey = getAnthropicKey();
  if (anthropicKey) h["x-anthropic-key"] = anthropicKey;
  return h;
}

// ─── Auth API Calls ─────────────────────────────────────────────────

export async function apiRegister(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } } | { error: string }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function apiLogin(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } } | { error: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

// ─── Admin ───────────────────────────────────────────────────────────

const ADMIN_EMAIL = "dowekavi@gmail.com";

export function isAdminUser(): boolean {
  try {
    const token = getAuthToken();
    if (!token) return false;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.email?.toLowerCase() === ADMIN_EMAIL;
  } catch {
    return false;
  }
}

export async function fetchAdminStats(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/admin/stats`, { headers: apiHeaders() });
  if (!res.ok) throw new Error("Forbidden");
  return res.json();
}

export async function fetchAdminUsers(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: apiHeaders() });
  if (!res.ok) throw new Error("Forbidden");
  return res.json();
}

export async function fetchAdminJobs(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/admin/jobs`, { headers: apiHeaders() });
  if (!res.ok) throw new Error("Forbidden");
  return res.json();
}

export async function fetchAdminHistory(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/admin/history`, { headers: apiHeaders() });
  if (!res.ok) throw new Error("Forbidden");
  return res.json();
}

export async function fetchAdminCache(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/admin/cache`, { headers: apiHeaders() });
  if (!res.ok) throw new Error("Forbidden");
  return res.json();
}

// ─── Generic Fetch ──────────────────────────────────────────────────

export async function fetchAPI(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const headers = { ...apiHeaders(), ...(options?.headers as Record<string, string> || {}) };
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

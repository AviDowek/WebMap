"use client";

import { useState, useEffect } from "react";
import type { Tab } from "../lib/types";
import { tabStyle, inputStyle, btnStyle } from "../lib/styles";
import {
  isLoggedIn,
  logout,
  setAuthToken,
  getAnthropicKey,
  setAnthropicKey,
  apiRegister,
  apiLogin,
} from "../lib/api";
import GenerateTab from "../components/GenerateTab";
import BatchTab from "../components/BatchTab";
import BenchmarkTab from "../components/BenchmarkTab";
import APIBrowser from "../components/APIBrowser";

// ─── Auth Gate ──────────────────────────────────────────────────────

function AuthGate({ onAuth }: { onAuth: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = mode === "register"
      ? await apiRegister(email, password)
      : await apiLogin(email, password);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setAuthToken(result.token);
    onAuth(result.user.email);
  }

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "80px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>
          <span style={{ color: "#3b82f6" }}>Web</span>Map
        </h1>
        <p style={{ color: "#888", fontSize: 16 }}>
          AI-powered website documentation for agents
        </p>
      </div>

      <div style={{
        backgroundColor: "#111", border: "1px solid #222", borderRadius: 12,
        padding: 32,
      }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
          <button
            onClick={() => { setMode("login"); setError(""); }}
            style={{
              flex: 1, padding: "10px 0", fontSize: 15, fontWeight: mode === "login" ? 700 : 400,
              backgroundColor: mode === "login" ? "#1a1a2e" : "transparent",
              color: mode === "login" ? "#3b82f6" : "#666",
              border: "1px solid #333", borderRadius: "8px 0 0 8px", cursor: "pointer",
            }}
          >
            Log In
          </button>
          <button
            onClick={() => { setMode("register"); setError(""); }}
            style={{
              flex: 1, padding: "10px 0", fontSize: 15, fontWeight: mode === "register" ? 700 : 400,
              backgroundColor: mode === "register" ? "#1a1a2e" : "transparent",
              color: mode === "register" ? "#3b82f6" : "#666",
              border: "1px solid #333", borderRadius: "0 8px 8px 0", cursor: "pointer",
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ ...inputStyle, width: "100%", marginBottom: 16, boxSizing: "border-box" }}
          />

          {error && (
            <div style={{
              color: "#ef4444", fontSize: 13, marginBottom: 12,
              padding: "8px 12px", backgroundColor: "#1a0000", borderRadius: 6,
              border: "1px solid #3a0000",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            style={{
              width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 600,
              borderRadius: 8, border: "none", cursor: loading ? "wait" : "pointer",
              backgroundColor: loading ? "#1e3a5f" : "#3b82f6", color: "#fff",
            }}
          >
            {loading ? "..." : mode === "register" ? "Create Account" : "Log In"}
          </button>
        </form>
      </div>
    </main>
  );
}

// ─── API Key Banner ─────────────────────────────────────────────────

function ApiKeyBanner() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    const existing = getAnthropicKey();
    if (existing) {
      setKey(existing);
      setSaved(true);
    } else {
      setShowInput(true);
    }
  }, []);

  function handleSave() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setAnthropicKey(trimmed);
    setSaved(true);
    setShowInput(false);
  }

  function handleClear() {
    setAnthropicKey("");
    setKey("");
    setSaved(false);
    setShowInput(true);
  }

  if (!showInput && saved) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 12, padding: "10px 16px", marginBottom: 24,
        backgroundColor: "#0a1a0a", border: "1px solid #1a3a1a", borderRadius: 8,
        fontSize: 13, color: "#6b8f6b",
      }}>
        <span>API key: {key.slice(0, 10)}...{key.slice(-4)}</span>
        <button onClick={() => setShowInput(true)} style={{ ...btnStyle, fontSize: 12, padding: "3px 10px" }}>
          Change
        </button>
        <button onClick={handleClear} style={{ ...btnStyle, fontSize: 12, padding: "3px 10px", color: "#ef4444", borderColor: "#ef444433" }}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding: "16px 20px", marginBottom: 24,
      backgroundColor: "#1a1000", border: "1px solid #3a2a00", borderRadius: 8,
    }}>
      <div style={{ fontSize: 14, color: "#d4a017", marginBottom: 10, fontWeight: 600 }}>
        Anthropic API Key Required
      </div>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
        Enter your Anthropic API key to use WebMap. Get one at{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"
          style={{ color: "#3b82f6", textDecoration: "underline" }}>
          console.anthropic.com
        </a>. Your key is stored locally in your browser only.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          placeholder="sk-ant-api03-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          style={{ ...inputStyle, fontSize: 14, padding: "10px 14px" }}
        />
        <button onClick={handleSave} disabled={!key.trim()}
          style={{
            ...btnStyle, backgroundColor: key.trim() ? "#3b82f6" : "#1e3a5f",
            color: "#fff", border: "none", fontWeight: 600,
          }}>
          Save
        </button>
        {saved && (
          <button onClick={() => setShowInput(false)} style={{ ...btnStyle, fontSize: 12 }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────

function App({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("generate");

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div />
        <div style={{ textAlign: "center", flex: 1 }}>
          <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>
            <span style={{ color: "#3b82f6" }}>Web</span>Map
          </h1>
          <p style={{ color: "#888", fontSize: 18, maxWidth: 600, margin: "0 auto" }}>
            Generate comprehensive website documentation for AI agents.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#666", fontSize: 13 }}>{userEmail}</span>
          <button onClick={onLogout} style={{ ...btnStyle, fontSize: 12, padding: "4px 12px", color: "#ef4444", borderColor: "#ef444433" }}>
            Log Out
          </button>
        </div>
      </div>

      {/* API Key Banner */}
      <ApiKeyBanner />

      {/* Tabs */}
      <div style={{
        display: "flex", justifyContent: "center", gap: 4,
        borderBottom: "1px solid #333", marginBottom: 32,
      }}>
        <button style={tabStyle(tab === "generate")} onClick={() => setTab("generate")}>Generate</button>
        <button style={tabStyle(tab === "batch")} onClick={() => setTab("batch")}>Batch Test</button>
        <button style={tabStyle(tab === "benchmark")} onClick={() => setTab("benchmark")}>Benchmark</button>
        <button style={tabStyle(tab === "apis")} onClick={() => setTab("apis")}>APIs</button>
      </div>

      {tab === "generate" && <GenerateTab />}
      {tab === "batch" && <BatchTab />}
      {tab === "benchmark" && <BenchmarkTab />}
      {tab === "apis" && <APIBrowser />}
    </main>
  );
}

// ─── Root ───────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check for existing auth on mount
    if (isLoggedIn()) {
      setAuthed(true);
      // Decode email from JWT payload (base64)
      try {
        const token = localStorage.getItem("webmap_auth_token") || "";
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUserEmail(payload.email || "");
      } catch {
        setUserEmail("");
      }
    }
    setReady(true);
  }, []);

  if (!ready) return null; // avoid flash

  function handleLogout() {
    logout();
    setAuthed(false);
    setUserEmail("");
  }

  if (!authed) {
    return <AuthGate onAuth={(email) => { setAuthed(true); setUserEmail(email); }} />;
  }

  return <App userEmail={userEmail} onLogout={handleLogout} />;
}

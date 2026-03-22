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
  isAdminUser,
} from "../lib/api";
import GenerateTab from "../components/GenerateTab";
import BatchTab from "../components/BatchTab";
import BenchmarkTab from "../components/BenchmarkTab";
import APIBrowser from "../components/APIBrowser";
import GuidePage from "../components/GuidePage";
import AdminTab from "../components/AdminTab";

// ─── Landing Page ───────────────────────────────────────────────────────

function LandingPage({ onAuth }: { onAuth: (email: string) => void }) {
  const [showAuth, setShowAuth] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("register");
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
    if ("error" in result) { setError(result.error); return; }
    setAuthToken(result.token);
    onAuth(result.user.email);
  }

  function openAuth(m: "login" | "register") {
    setMode(m);
    setShowAuth(true);
    setError("");
  }

  // Feature cards data
  const features = [
    {
      icon: "\u{1F9EA}",
      title: "11 CUA Methods",
      desc: "Compare vision-based, accessibility-tree, hybrid, cascade, and programmatic approaches side-by-side on real websites.",
    },
    {
      icon: "\u{1F4CA}",
      title: "Multi-Method Benchmarks",
      desc: "Run the same tasks across all methods simultaneously. Get composite scores weighing accuracy (50%), cost (30%), and speed (20%).",
    },
    {
      icon: "\u{1F30D}",
      title: "Real Websites, Real Tasks",
      desc: "Test on any live website with custom tasks, or use industry datasets like Mind2Web, WebBench, and WebArena.",
    },
    {
      icon: "\u{1F4B0}",
      title: "Cost & Token Tracking",
      desc: "Precise per-step cost tracking with cache-aware pricing. Know exactly what each method costs per task before you run.",
    },
    {
      icon: "\u{26A1}",
      title: "Site Doc Generation",
      desc: "Crawl any site to produce structured markdown docs. Test whether giving agents site documentation improves task success.",
    },
    {
      icon: "\u{1F512}",
      title: "Bring Your Own Key",
      desc: "Your Anthropic API key stays in your browser. We never store it. All data is private and scoped to your account.",
    },
  ];

  const howItWorks = [
    { step: "1", title: "Sign up & add your API key", desc: "Create a free account and paste your Anthropic API key. It stays in your browser." },
    { step: "2", title: "Add sites & tasks", desc: "Configure target websites and define tasks (e.g. \"search for laptops\", \"add item to cart\"), or load an industry dataset." },
    { step: "3", title: "Run & compare", desc: "Select which CUA methods to test, hit run, and get a detailed comparison of accuracy, cost, speed, and overall score." },
  ];

  return (
    <div style={{ backgroundColor: "#0a0a0a", color: "#ededed", minHeight: "100vh" }}>
      {/* Nav */}
      <nav style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        maxWidth: 1200, margin: "0 auto", padding: "20px 24px",
      }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          <span style={{ color: "#3b82f6" }}>Web</span>Map
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => openAuth("login")} style={{
            padding: "8px 20px", fontSize: 14, borderRadius: 8,
            border: "1px solid #333", backgroundColor: "transparent",
            color: "#ededed", cursor: "pointer",
          }}>
            Log In
          </button>
          <button onClick={() => openAuth("register")} style={{
            padding: "8px 20px", fontSize: 14, borderRadius: 8,
            border: "none", backgroundColor: "#3b82f6",
            color: "#fff", cursor: "pointer", fontWeight: 600,
          }}>
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        maxWidth: 800, margin: "0 auto", textAlign: "center",
        padding: "80px 24px 60px",
      }}>
        <div style={{
          display: "inline-block", padding: "6px 16px", borderRadius: 20,
          backgroundColor: "#1a1a2e", border: "1px solid #2a2a4e",
          fontSize: 13, color: "#818cf8", marginBottom: 24,
        }}>
          Open-source CUA research platform
        </div>
        <h1 style={{
          fontSize: 56, fontWeight: 800, lineHeight: 1.1,
          marginBottom: 20, letterSpacing: "-0.02em",
        }}>
          Benchmark{" "}
          <span style={{
            background: "linear-gradient(135deg, #3b82f6, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Computer Use Agents
          </span>
          {" "}on real websites
        </h1>
        <p style={{
          fontSize: 20, color: "#888", lineHeight: 1.6,
          maxWidth: 640, margin: "0 auto 40px",
        }}>
          Compare 11 different CUA methods head-to-head \u2014 vision, accessibility tree,
          hybrid, cascade, programmatic \u2014 and find which approach actually works best
          for your use case.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <button onClick={() => openAuth("register")} style={{
            padding: "14px 32px", fontSize: 17, fontWeight: 600,
            borderRadius: 10, border: "none", backgroundColor: "#3b82f6",
            color: "#fff", cursor: "pointer",
          }}>
            Start for Free
          </button>
          <button onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} style={{
            padding: "14px 32px", fontSize: 17, fontWeight: 500,
            borderRadius: 10, border: "1px solid #333", backgroundColor: "transparent",
            color: "#ededed", cursor: "pointer",
          }}>
            Learn More
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#555", marginTop: 16 }}>
          Free to use &mdash; you only pay for your own Anthropic API usage.
        </p>
      </section>

      {/* Features */}
      <section id="features" style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px" }}>
        <h2 style={{ textAlign: "center", fontSize: 32, fontWeight: 700, marginBottom: 12 }}>
          Built for CUA research
        </h2>
        <p style={{ textAlign: "center", fontSize: 16, color: "#666", marginBottom: 48 }}>
          Everything you need to test, measure, and compare computer use agent methods.
        </p>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 20,
        }}>
          {features.map((f) => (
            <div key={f.title} style={{
              backgroundColor: "#111", border: "1px solid #1a1a1a",
              borderRadius: 12, padding: "28px 24px",
              transition: "border-color 0.2s",
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#ededed" }}>
                {f.title}
              </h3>
              <p style={{ fontSize: 14, color: "#888", lineHeight: 1.6, margin: 0 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{
        backgroundColor: "#080810", borderTop: "1px solid #1a1a1a",
        borderBottom: "1px solid #1a1a1a", padding: "80px 24px",
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: 32, fontWeight: 700, marginBottom: 48 }}>
            How it works
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {howItWorks.map((s) => (
              <div key={s.step} style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  backgroundColor: "#1a1a2e", border: "2px solid #3b82f6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 700, color: "#3b82f6", flexShrink: 0,
                }}>
                  {s.step}
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, color: "#ededed" }}>
                    {s.title}
                  </h3>
                  <p style={{ fontSize: 15, color: "#888", lineHeight: 1.6, margin: 0 }}>
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        maxWidth: 600, margin: "0 auto", textAlign: "center",
        padding: "80px 24px 100px",
      }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, marginBottom: 12 }}>
          Start benchmarking
        </h2>
        <p style={{ fontSize: 16, color: "#888", marginBottom: 32 }}>
          Create an account, bring your own API key, and run your first comparison in minutes.
        </p>
        <button onClick={() => openAuth("register")} style={{
          padding: "16px 40px", fontSize: 18, fontWeight: 600,
          borderRadius: 10, border: "none", backgroundColor: "#3b82f6",
          color: "#fff", cursor: "pointer",
        }}>
          Create Free Account
        </button>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid #1a1a1a", padding: "24px",
        textAlign: "center", fontSize: 13, color: "#444",
      }}>
        WebMap &mdash; Open-source CUA benchmarking platform
      </footer>

      {/* Auth Modal */}
      {showAuth && (
        <div
          onClick={() => setShowAuth(false)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#111", border: "1px solid #222", borderRadius: 16,
              padding: 36, width: 400, maxWidth: "90vw",
            }}
          >
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, textAlign: "center" }}>
              <span style={{ color: "#3b82f6" }}>Web</span>Map
            </h2>
            <p style={{ color: "#666", fontSize: 14, textAlign: "center", marginBottom: 24 }}>
              {mode === "register" ? "Create your account" : "Welcome back"}
            </p>

            <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
              <button
                onClick={() => { setMode("login"); setError(""); }}
                style={{
                  flex: 1, padding: "10px 0", fontSize: 14, fontWeight: mode === "login" ? 700 : 400,
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
                  flex: 1, padding: "10px 0", fontSize: 14, fontWeight: mode === "register" ? 700 : 400,
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
                type="email" placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)} required
                style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
              />
              <input
                type="password" placeholder="Password (min 8 characters)" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={8}
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
                type="submit" disabled={loading || !email || !password}
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
        </div>
      )}
    </div>
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
        <button style={tabStyle(tab === "guide")} onClick={() => setTab("guide")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Guide
          </span>
        </button>
        {isAdminUser() && (
          <button style={tabStyle(tab === "admin")} onClick={() => setTab("admin")}>
            Admin
          </button>
        )}
      </div>

      {tab === "generate" && <GenerateTab />}
      {tab === "batch" && <BatchTab />}
      {tab === "benchmark" && <BenchmarkTab />}
      {tab === "apis" && <APIBrowser />}
      {tab === "guide" && <GuidePage />}
      {tab === "admin" && <AdminTab />}
    </main>
  );
}

// ─── Root ───────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      setAuthed(true);
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

  if (!ready) return null;

  function handleLogout() {
    logout();
    setAuthed(false);
    setUserEmail("");
  }

  if (!authed) {
    return <LandingPage onAuth={(email) => { setAuthed(true); setUserEmail(email); }} />;
  }

  return <App userEmail={userEmail} onLogout={handleLogout} />;
}

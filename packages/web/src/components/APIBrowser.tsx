"use client";

import { useState, useEffect } from "react";
import { API_BASE } from "../lib/constants";
import { cardStyle, sectionStyle, btnStyle, primaryBtn } from "../lib/styles";

// ─── Types ───────────────────────────────────────────────────────

interface DomainSummary {
  domain: string;
  totalActions: number;
  verifiedPassed: number;
  totalPages: number;
  generatedAt: string;
  rootUrl: string;
}

interface ActionParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  options?: string[];
  testDefault?: string;
}

interface ActionStep {
  type: string;
  selector?: string;
  value?: string;
  timeout?: number;
}

interface SiteAction {
  id: string;
  name: string;
  description: string;
  tier: string;
  pagePattern: string;
  sourceUrl: string;
  steps: ActionStep[];
  params: ActionParam[];
  expectedResult: {
    description: string;
    urlChange?: string;
    a11yDiff?: { shouldAppear?: string[]; shouldDisappear?: string[] };
  };
  reliability: string;
  successCount: number;
  failureCount: number;
  source: string;
}

interface PageAPI {
  urlPattern: string;
  canonicalUrl: string;
  description: string;
  actions: SiteAction[];
}

interface DomainAPI {
  domain: string;
  rootUrl: string;
  generatedAt: string;
  globalActions: SiteAction[];
  pages: Record<string, PageAPI>;
  stats: {
    totalActions: number;
    verifiedPassed: number;
    verifiedFailed: number;
    untested: number;
    stale: number;
    totalPages: number;
    totalNetworkEndpoints: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function reliabilityBadge(r: string): { text: string; color: string } {
  switch (r) {
    case "verified-passed": return { text: "Verified", color: "#22c55e" };
    case "verified-failed": return { text: "Failed", color: "#ef4444" };
    case "untested": return { text: "Untested", color: "#f59e0b" };
    case "stale": return { text: "Stale", color: "#888" };
    default: return { text: r, color: "#888" };
  }
}

function tierColor(tier: string): string {
  switch (tier) {
    case "navigation": return "#3b82f6";
    case "interaction": return "#22c55e";
    case "direct-api": return "#a855f7";
    default: return "#888";
  }
}

const apiHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const key = (window as unknown as Record<string, string>).__WEBMAP_API_KEY;
    if (key) h["Authorization"] = `Bearer ${key}`;
  }
  return h;
};

// ─── Component ───────────────────────────────────────────────────

export default function APIBrowser() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [domainApi, setDomainApi] = useState<DomainAPI | null>(null);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [discoverUrl, setDiscoverUrl] = useState("");
  const [discoverStatus, setDiscoverStatus] = useState<string | null>(null);

  // Fetch domain list on mount
  useEffect(() => {
    fetchDomains();
  }, []);

  async function fetchDomains() {
    try {
      const res = await fetch(`${API_BASE}/api/api-gen/domains`, { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDomains(data.domains || []);
      }
    } catch { /* ignore */ }
  }

  async function loadDomainAPI(domain: string) {
    setLoading(true);
    setSelectedDomain(domain);
    setExpandedPage(null);
    setExpandedAction(null);
    try {
      const res = await fetch(`${API_BASE}/api/api-gen/${domain}`, { headers: apiHeaders() });
      if (res.ok) {
        setDomainApi(await res.json());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function startDiscovery() {
    if (!discoverUrl) return;
    setDiscoverStatus("Starting discovery...");
    try {
      const res = await fetch(`${API_BASE}/api/api-gen/discover`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ url: discoverUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoverStatus(`Running... (Job: ${data.jobId})`);
        // Poll status
        let missCount = 0;
        const interval = setInterval(async () => {
          try {
            const sRes = await fetch(`${API_BASE}/api/api-gen/status/${data.jobId}`, { headers: apiHeaders() });
            if (sRes.ok) {
              missCount = 0;
              const status = await sRes.json();
              if (status.status === "done") {
                clearInterval(interval);
                setDiscoverStatus(`Done! ${status.stats?.totalActions ?? 0} actions generated`);
                fetchDomains();
              } else if (status.status === "error") {
                clearInterval(interval);
                setDiscoverStatus(`Error: ${status.error}`);
              }
            } else if (sRes.status === 404) {
              missCount++;
              if (missCount >= 2) {
                clearInterval(interval);
                setDiscoverStatus("Job lost — server likely restarted during crawl. Try again, or use 'npm run start' instead of dev mode for long crawls.");
              }
            }
          } catch {
            missCount++;
            if (missCount >= 3) {
              clearInterval(interval);
              setDiscoverStatus("Connection lost — server may have restarted. Check terminal for errors.");
            }
          }
        }, 3000);
      } else {
        setDiscoverStatus("Failed to start discovery");
      }
    } catch (e) {
      setDiscoverStatus(`Error: ${e}`);
    }
  }

  async function startSelfTest(domain: string) {
    try {
      const res = await fetch(`${API_BASE}/api/api-gen/${domain}/test`, {
        method: "POST",
        headers: apiHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoverStatus(`Self-test started (Job: ${data.jobId})`);
      }
    } catch { /* ignore */ }
  }

  async function deleteDomain(domain: string) {
    try {
      await fetch(`${API_BASE}/api/api-gen/${domain}`, { method: "DELETE", headers: apiHeaders() });
      setDomains((d) => d.filter((dd) => dd.domain !== domain));
      if (selectedDomain === domain) {
        setSelectedDomain(null);
        setDomainApi(null);
      }
    } catch { /* ignore */ }
  }

  function downloadJSON() {
    if (!domainApi) return;
    const blob = new Blob([JSON.stringify(domainApi, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${domainApi.domain}-api.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pages = domainApi ? Object.entries(domainApi.pages) : [];

  return (
    <div>
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Generated Site APIs</h2>
        <p style={{ color: "#888", fontSize: 13, margin: "0 0 16px" }}>
          Programmatic interfaces auto-discovered from websites
        </p>

        {/* Discover new site */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={discoverUrl}
            onChange={(e) => setDiscoverUrl(e.target.value)}
            placeholder="https://example.com"
            style={{ flex: 1, padding: "10px 14px", fontSize: 14, borderRadius: 6, border: "1px solid #333", backgroundColor: "#1a1a1a", color: "#ededed", outline: "none" }}
          />
          <button onClick={startDiscovery} disabled={!discoverUrl} style={primaryBtn(!discoverUrl)}>
            Discover APIs
          </button>
        </div>
        {discoverStatus && (
          <p style={{ color: "#888", fontSize: 12, margin: "0 0 12px" }}>{discoverStatus}</p>
        )}

        {/* Site pills */}
        {domains.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {domains.map((d) => (
              <button
                key={d.domain}
                onClick={() => loadDomainAPI(d.domain)}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: selectedDomain === d.domain ? 700 : 400,
                  borderRadius: 20,
                  border: `1px solid ${selectedDomain === d.domain ? "#14b8a6" : "#333"}`,
                  backgroundColor: selectedDomain === d.domain ? "#14b8a622" : "#1a1a1a",
                  color: selectedDomain === d.domain ? "#14b8a6" : "#aaa",
                  cursor: "pointer",
                }}
              >
                {d.domain} ({d.totalActions})
              </button>
            ))}
          </div>
        )}

        {domains.length === 0 && !loading && (
          <p style={{ color: "#555", fontSize: 13, textAlign: "center", padding: 20 }}>
            No APIs generated yet. Enter a URL above to discover site APIs.
          </p>
        )}
      </div>

      {loading && (
        <div style={{ ...sectionStyle, textAlign: "center", color: "#888" }}>Loading...</div>
      )}

      {domainApi && !loading && (
        <>
          {/* Stats cards */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginTop: 4 }}>{domainApi.stats.totalActions}</div>
              <div style={{ fontSize: 11, color: "#888" }}>actions</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Verified</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e", marginTop: 4 }}>{domainApi.stats.verifiedPassed}</div>
              <div style={{ fontSize: 11, color: "#888" }}>
                ({domainApi.stats.totalActions > 0 ? ((domainApi.stats.verifiedPassed / domainApi.stats.totalActions) * 100).toFixed(0) : 0}%)
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Failed</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#ef4444", marginTop: 4 }}>{domainApi.stats.verifiedFailed}</div>
              <div style={{ fontSize: 11, color: "#888" }}>
                ({domainApi.stats.totalActions > 0 ? ((domainApi.stats.verifiedFailed / domainApi.stats.totalActions) * 100).toFixed(0) : 0}%)
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Pages</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginTop: 4 }}>{domainApi.stats.totalPages}</div>
              <div style={{ fontSize: 11, color: "#888" }}>covered</div>
            </div>
          </div>

          {/* Page groups */}
          <div style={sectionStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Page Actions</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => startSelfTest(domainApi.domain)} style={btnStyle}>Run Self-Test</button>
                <button onClick={downloadJSON} style={btnStyle}>Export JSON</button>
                <button onClick={() => deleteDomain(domainApi.domain)} style={{ ...btnStyle, color: "#ef4444", borderColor: "#ef444433" }}>Delete</button>
              </div>
            </div>

            {pages.map(([pattern, pageApi]) => {
              const isExpanded = expandedPage === pattern;
              return (
                <div key={pattern} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, marginBottom: 8, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpandedPage(isExpanded ? null : pattern)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>Page: {pattern}</span>
                      <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>{pageApi.description}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ color: "#888", fontSize: 12 }}>{pageApi.actions.length} actions</span>
                      <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: "0 16px 16px" }}>
                      {pageApi.actions.map((action) => {
                        const isActionExpanded = expandedAction === action.id;
                        const badge = reliabilityBadge(action.reliability);
                        return (
                          <div key={action.id} style={{ borderBottom: "1px solid #222" }}>
                            <div
                              onClick={() => setExpandedAction(isActionExpanded ? null : action.id)}
                              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", cursor: "pointer" }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12 }}>{isActionExpanded ? "▼" : "▶"}</span>
                                <span style={{ fontWeight: 600, fontSize: 13, color: "#ededed" }}>{action.name}</span>
                                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, backgroundColor: `${tierColor(action.tier)}22`, color: tierColor(action.tier) }}>
                                  {action.tier}
                                </span>
                                <span style={{ fontSize: 11, color: badge.color }}>{badge.text}</span>
                              </div>
                              <span style={{ fontSize: 12, color: "#555" }}>{action.source}</span>
                            </div>

                            {isActionExpanded && (
                              <div style={{ padding: "8px 0 16px 20px", fontSize: 13 }}>
                                <div style={{ color: "#aaa", marginBottom: 8 }}>{action.description}</div>

                                {action.params.length > 0 && (
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Parameters</div>
                                    {action.params.map((p) => (
                                      <div key={p.name} style={{ color: "#aaa", fontSize: 12, marginLeft: 8, marginBottom: 2 }}>
                                        <span style={{ color: "#14b8a6", fontFamily: "monospace" }}>{p.name}</span>
                                        <span style={{ color: "#555" }}> ({p.type}{p.required ? ", required" : ""})</span>
                                        {p.description && <span style={{ color: "#666" }}> — {p.description}</span>}
                                        {p.options && <span style={{ color: "#555" }}> [{p.options.join(", ")}]</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Steps</div>
                                  {action.steps.map((step, i) => (
                                    <div key={i} style={{ color: "#aaa", fontSize: 12, marginLeft: 8, marginBottom: 2, fontFamily: "monospace" }}>
                                      {i + 1}. {step.type}{step.selector ? ` ${step.selector}` : ""}{step.value ? ` → ${step.value}` : ""}
                                    </div>
                                  ))}
                                </div>

                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Expected Result</div>
                                  <div style={{ color: "#aaa", fontSize: 12, marginLeft: 8 }}>{action.expectedResult.description}</div>
                                  {action.expectedResult.urlChange && (
                                    <div style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>URL: {action.expectedResult.urlChange}</div>
                                  )}
                                </div>

                                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#555" }}>
                                  <span>Successes: {action.successCount}</span>
                                  <span>Failures: {action.failureCount}</span>
                                  <span>Source: {action.source}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Global Navigation */}
            {domainApi.globalActions.length > 0 && (
              <div style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, marginTop: 16, overflow: "hidden" }}>
                <div
                  onClick={() => setExpandedPage(expandedPage === "__global" ? null : "__global")}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Global Navigation (always available)</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: "#888", fontSize: 12 }}>{domainApi.globalActions.length} actions</span>
                    <span style={{ color: "#555", fontSize: 14 }}>{expandedPage === "__global" ? "▲" : "▼"}</span>
                  </div>
                </div>

                {expandedPage === "__global" && (
                  <div style={{ padding: "8px 16px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {domainApi.globalActions.map((action) => {
                      const badge = reliabilityBadge(action.reliability);
                      return (
                        <div key={action.id} style={{ padding: "6px 12px", fontSize: 12, backgroundColor: "#111", border: "1px solid #222", borderRadius: 6 }}>
                          <span style={{ fontWeight: 600, color: "#ededed" }}>{action.name}</span>
                          <span style={{ color: badge.color, marginLeft: 6, fontSize: 11 }}>{badge.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

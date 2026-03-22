"use client";

import { useState, useEffect, useCallback } from "react";
import { sectionStyle, btnStyle } from "../lib/styles";
import {
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminJobs,
  fetchAdminHistory,
  fetchAdminCache,
} from "../lib/api";

// ─── Types ───────────────────────────────────────────────────────────

interface StatsData {
  users: { total: number; recentSignups: Array<{ email: string; createdAt: string }> };
  jobs: {
    crawls: { total: number; active: number; done: number; error: number };
    batches: { total: number; active: number; done: number };
    benchmarks: { total: number; active: number; done: number; error: number };
  };
  history: { benchmarkRuns: number; multiMethodRuns: number };
  cache: { docsEntries: number; benchmarkSites: number };
  server: { uptime: number; memoryMB: number; nodeVersion: string };
}

interface UserData {
  id: string;
  email: string;
  createdAt: string;
  activity: {
    crawls: number;
    batches: number;
    benchmarks: number;
    benchmarkHistory: number;
    multiMethodHistory: number;
    sites: number;
    cachedDocs: number;
  };
}

interface JobData {
  crawls: Array<{ id: string; type: string; status: string; ownerId?: string; error?: string; pagesFound?: number }>;
  batches: Array<{ id: string; type: string; status: string; ownerId?: string; sitesCount: number; startedAt: string }>;
  benchmarks: Array<{ id: string; type: string; status: string; ownerId?: string; multiMethod?: boolean; tasksTotal: number; tasksCompleted: number; currentSite?: string; currentMethod?: string; error?: string }>;
}

interface HistoryData {
  benchmark: Array<{ id: string; timestamp: string; ownerId?: string; tasksTotal: number; baselineSuccess?: number; withDocsSuccess?: number }>;
  multiMethod: Array<{ id: string; timestamp: string; ownerId?: string; sites: number; methods: string[]; totalTasks: number }>;
}

interface CacheData {
  total: number;
  active: number;
  expired: number;
  entries: Array<{ key: string; userId: string | null; domain: string; expiresAt: string; expired: boolean; hasResult: boolean }>;
}

type AdminSection = "overview" | "users" | "jobs" | "history" | "cache";

// ─── Helpers ─────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

const statCard = (label: string, value: string | number, color = "#ededed") => (
  <div style={{
    flex: 1, backgroundColor: "#0a0a0a", border: "1px solid #222",
    borderRadius: 8, padding: "16px 20px", textAlign: "center", minWidth: 140,
  }}>
    <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{label}</div>
  </div>
);

const statusBadge = (status: string) => {
  const colors: Record<string, string> = {
    done: "#22c55e", error: "#ef4444", running: "#3b82f6",
    crawling: "#3b82f6", analyzing: "#a855f7", queued: "#888",
    "generating-docs": "#a855f7", "generating-tasks": "#a855f7",
    "running-baseline": "#3b82f6", "running-with-docs": "#3b82f6",
  };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, backgroundColor: `${colors[status] || "#888"}22`,
      color: colors[status] || "#888", border: `1px solid ${colors[status] || "#888"}44`,
    }}>
      {status}
    </span>
  );
};

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333",
  color: "#888", fontWeight: 600, fontSize: 11, textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px", borderBottom: "1px solid #1a1a1a", color: "#ccc",
};

// ─── Component ───────────────────────────────────────────────────────

export default function AdminTab() {
  const [section, setSection] = useState<AdminSection>("overview");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [users, setUsers] = useState<{ total: number; users: UserData[] } | null>(null);
  const [jobs, setJobs] = useState<JobData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [cache, setCache] = useState<CacheData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSection = useCallback(async (s: AdminSection) => {
    setLoading(true);
    setError("");
    try {
      switch (s) {
        case "overview":
          setStats(await fetchAdminStats() as StatsData);
          break;
        case "users":
          setUsers(await fetchAdminUsers() as { total: number; users: UserData[] });
          break;
        case "jobs":
          setJobs(await fetchAdminJobs() as JobData);
          break;
        case "history":
          setHistory(await fetchAdminHistory() as HistoryData);
          break;
        case "cache":
          setCache(await fetchAdminCache() as CacheData);
          break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin data");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSection(section);
  }, [section, loadSection]);

  const navBtn = (s: AdminSection, label: string) => (
    <button
      onClick={() => setSection(s)}
      style={{
        ...btnStyle,
        backgroundColor: section === s ? "#1a1a2e" : "#1a1a1a",
        color: section === s ? "#3b82f6" : "#888",
        borderColor: section === s ? "#3b82f6" : "#333",
        fontWeight: section === s ? 700 : 400,
      }}
    >
      {label}
    </button>
  );

  // Build a userId → email lookup from the users data or stats
  const userEmailMap = new Map<string, string>();
  if (users) {
    for (const u of users.users) {
      userEmailMap.set(u.id, u.email);
    }
  }
  const ownerLabel = (ownerId?: string | null) => {
    if (!ownerId) return <span style={{ color: "#555" }}>—</span>;
    const email = userEmailMap.get(ownerId);
    return <span style={{ color: "#888" }}>{email || shortId(ownerId)}</span>;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#ededed", margin: 0 }}>
          Admin Dashboard
        </h2>
        <button
          onClick={() => loadSection(section)}
          style={{ ...btnStyle, fontSize: 12, padding: "4px 12px" }}
        >
          Refresh
        </button>
      </div>

      {/* Section nav */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {navBtn("overview", "Overview")}
        {navBtn("users", "Users")}
        {navBtn("jobs", "Jobs")}
        {navBtn("history", "History")}
        {navBtn("cache", "Cache")}
      </div>

      {error && (
        <div style={{
          color: "#ef4444", padding: "12px 16px", backgroundColor: "#1a0000",
          border: "1px solid #3a0000", borderRadius: 8, marginBottom: 20, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {loading && <div style={{ color: "#888", padding: 20 }}>Loading...</div>}

      {/* ─── Overview ─── */}
      {section === "overview" && stats && !loading && (
        <div>
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>Platform Metrics</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {statCard("Total Users", stats.users.total, "#3b82f6")}
              {statCard("Docs Cached", stats.cache.docsEntries, "#22c55e")}
              {statCard("Benchmark Sites", stats.cache.benchmarkSites, "#a855f7")}
              {statCard("Benchmark Runs", stats.history.benchmarkRuns, "#f59e0b")}
              {statCard("Multi-Method Runs", stats.history.multiMethodRuns, "#ec4899")}
            </div>
          </div>

          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>Active Jobs</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {statCard("Active Crawls", stats.jobs.crawls.active, stats.jobs.crawls.active > 0 ? "#3b82f6" : "#888")}
              {statCard("Active Batches", stats.jobs.batches.active, stats.jobs.batches.active > 0 ? "#3b82f6" : "#888")}
              {statCard("Active Benchmarks", stats.jobs.benchmarks.active, stats.jobs.benchmarks.active > 0 ? "#3b82f6" : "#888")}
              {statCard("Failed Jobs", stats.jobs.crawls.error + stats.jobs.benchmarks.error, stats.jobs.crawls.error + stats.jobs.benchmarks.error > 0 ? "#ef4444" : "#888")}
            </div>
          </div>

          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>Server</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {statCard("Uptime", formatUptime(stats.server.uptime))}
              {statCard("Memory", `${stats.server.memoryMB} MB`)}
              {statCard("Node.js", stats.server.nodeVersion)}
            </div>
          </div>

          {stats.users.recentSignups.length > 0 && (
            <div style={sectionStyle}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>Recent Signups</h3>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Signed Up</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.users.recentSignups.map((u) => (
                    <tr key={u.email}>
                      <td style={tdStyle}>{u.email}</td>
                      <td style={tdStyle}>{formatDate(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Users ─── */}
      {section === "users" && users && !loading && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
            All Users ({users.total})
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Signed Up</th>
                  <th style={thStyle}>Crawls</th>
                  <th style={thStyle}>Batches</th>
                  <th style={thStyle}>Benchmarks</th>
                  <th style={thStyle}>Multi-Method</th>
                  <th style={thStyle}>Sites</th>
                  <th style={thStyle}>Docs</th>
                </tr>
              </thead>
              <tbody>
                {users.users.map((u) => (
                  <tr key={u.id}>
                    <td style={tdStyle}>
                      <div>{u.email}</div>
                      <div style={{ fontSize: 10, color: "#555" }}>{shortId(u.id)}</div>
                    </td>
                    <td style={tdStyle}>{formatDate(u.createdAt)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.crawls || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.batches || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.benchmarkHistory || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.multiMethodHistory || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.sites || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{u.activity.cachedDocs || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Jobs ─── */}
      {section === "jobs" && jobs && !loading && (
        <div>
          {/* Crawls */}
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
              Crawl Jobs ({jobs.crawls.length})
            </h3>
            {jobs.crawls.length === 0 ? (
              <div style={{ color: "#555", fontSize: 14 }}>No crawl jobs</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.crawls.map((j) => (
                    <tr key={j.id}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{shortId(j.id)}</td>
                      <td style={tdStyle}>{statusBadge(j.status)}</td>
                      <td style={tdStyle}>{ownerLabel(j.ownerId)}</td>
                      <td style={tdStyle}>{j.pagesFound ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Batches */}
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
              Batch Jobs ({jobs.batches.length})
            </h3>
            {jobs.batches.length === 0 ? (
              <div style={{ color: "#555", fontSize: 14 }}>No batch jobs</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Sites</th>
                    <th style={thStyle}>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.batches.map((b) => (
                    <tr key={b.id}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{shortId(b.id)}</td>
                      <td style={tdStyle}>{statusBadge(b.status)}</td>
                      <td style={tdStyle}>{ownerLabel(b.ownerId)}</td>
                      <td style={tdStyle}>{b.sitesCount}</td>
                      <td style={tdStyle}>{formatDate(b.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Benchmarks */}
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
              Benchmark Jobs ({jobs.benchmarks.length})
            </h3>
            {jobs.benchmarks.length === 0 ? (
              <div style={{ color: "#555", fontSize: 14 }}>No benchmark jobs</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Progress</th>
                    <th style={thStyle}>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.benchmarks.map((b) => (
                    <tr key={b.id}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{shortId(b.id)}</td>
                      <td style={tdStyle}>{statusBadge(b.status)}</td>
                      <td style={tdStyle}>{ownerLabel(b.ownerId)}</td>
                      <td style={tdStyle}>{b.multiMethod ? "Multi" : "A/B"}</td>
                      <td style={tdStyle}>{b.tasksCompleted}/{b.tasksTotal}</td>
                      <td style={tdStyle}>
                        {b.currentSite && <span style={{ color: "#888" }}>{b.currentSite}</span>}
                        {b.currentMethod && <span style={{ color: "#3b82f6", marginLeft: 4 }}>{b.currentMethod}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ─── History ─── */}
      {section === "history" && history && !loading && (
        <div>
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
              A/B Benchmark History ({history.benchmark.length})
            </h3>
            {history.benchmark.length === 0 ? (
              <div style={{ color: "#555", fontSize: 14 }}>No benchmark history</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Tasks</th>
                    <th style={thStyle}>Baseline</th>
                    <th style={thStyle}>With Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {history.benchmark.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{shortId(r.id)}</td>
                      <td style={tdStyle}>{formatDate(r.timestamp)}</td>
                      <td style={tdStyle}>{ownerLabel(r.ownerId)}</td>
                      <td style={tdStyle}>{r.tasksTotal}</td>
                      <td style={tdStyle}>{r.baselineSuccess != null ? `${(r.baselineSuccess * 100).toFixed(0)}%` : "—"}</td>
                      <td style={tdStyle}>{r.withDocsSuccess != null ? `${(r.withDocsSuccess * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={sectionStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
              Multi-Method History ({history.multiMethod.length})
            </h3>
            {history.multiMethod.length === 0 ? (
              <div style={{ color: "#555", fontSize: 14 }}>No multi-method history</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Sites</th>
                    <th style={thStyle}>Methods</th>
                    <th style={thStyle}>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {history.multiMethod.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{shortId(r.id)}</td>
                      <td style={tdStyle}>{formatDate(r.timestamp)}</td>
                      <td style={tdStyle}>{ownerLabel(r.ownerId)}</td>
                      <td style={tdStyle}>{r.sites}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {r.methods.slice(0, 4).map((m) => (
                            <span key={m} style={{
                              padding: "1px 6px", borderRadius: 3, fontSize: 10,
                              backgroundColor: "#1a1a2e", color: "#818cf8",
                            }}>
                              {m}
                            </span>
                          ))}
                          {r.methods.length > 4 && (
                            <span style={{ fontSize: 10, color: "#555" }}>+{r.methods.length - 4}</span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>{r.totalTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ─── Cache ─── */}
      {section === "cache" && cache && !loading && (
        <div style={sectionStyle}>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            {statCard("Total Entries", cache.total)}
            {statCard("Active", cache.active, "#22c55e")}
            {statCard("Expired", cache.expired, "#ef4444")}
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#ededed" }}>
            Cache Entries
          </h3>
          {cache.entries.length === 0 ? (
            <div style={{ color: "#555", fontSize: 14 }}>No cache entries</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Domain</th>
                  <th style={thStyle}>User</th>
                  <th style={thStyle}>Expires</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {cache.entries.map((e) => (
                  <tr key={e.key}>
                    <td style={tdStyle}>{e.domain}</td>
                    <td style={tdStyle}>{ownerLabel(e.userId)}</td>
                    <td style={tdStyle}>{formatDate(e.expiresAt)}</td>
                    <td style={tdStyle}>
                      {e.expired
                        ? <span style={{ color: "#ef4444", fontSize: 11 }}>expired</span>
                        : <span style={{ color: "#22c55e", fontSize: 11 }}>active</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

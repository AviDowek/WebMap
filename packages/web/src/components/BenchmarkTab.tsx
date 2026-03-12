"use client";

import { useState, useRef, useEffect } from "react";
import type {
  BenchmarkStatus,
  BenchmarkSite,
  BenchmarkHistoryEntry,
  MultiMethodHistoryEntry,
  MultiMethodResult,
  DocMethod,
} from "../lib/types";
import {
  API_BASE,
  MAX_BENCHMARK_POLL_ATTEMPTS,
  DOC_METHOD_LABELS,
  DOC_METHOD_DESCRIPTIONS,
  METHOD_COLORS,
  ALL_DOC_METHODS,
  METHOD_AVG_TOKENS,
} from "../lib/constants";
import { btnStyle, primaryBtn, inputStyle } from "../lib/styles";
import { computeEstimatedCost, formatUsd } from "../lib/utils";
import MultiMethodResults from "./MultiMethodResults";
import BenchmarkResults from "./BenchmarkResults";

function ErrorBox({ error }: { error?: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: 20,
        color: "#ef4444",
        backgroundColor: "#1a0000",
        borderRadius: 8,
        maxWidth: 700,
        margin: "0 auto",
      }}
    >
      Error: {error}
    </div>
  );
}

export default function BenchmarkTab() {
  const [sites, setSites] = useState<BenchmarkSite[]>([]);
  const [status, setStatus] = useState<BenchmarkStatus>({ state: "idle" });
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ instruction: "", successCriteria: "", category: "navigation" });
  const [generating, setGenerating] = useState<string | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [history, setHistory] = useState<BenchmarkHistoryEntry[]>([]);
  const [multiHistory, setMultiHistory] = useState<MultiMethodHistoryEntry[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<BenchmarkStatus["result"] | null>(null);
  const [expandedMultiResult, setExpandedMultiResult] = useState<MultiMethodResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Multi-method config
  const [siteCount, setSiteCount] = useState(5);
  const [tasksPerSite, setTasksPerSite] = useState(3);
  const [selectedMethods, setSelectedMethods] = useState<DocMethod[]>([...ALL_DOC_METHODS]);
  const [generatingSites, setGeneratingSites] = useState(false);
  const [runsPerTask, setRunsPerTask] = useState(1);
  const [verifyResults, setVerifyResults] = useState(false);
  // Dataset config
  const [taskSource, setTaskSource] = useState<"custom" | "dataset">("custom");
  const [datasetId, setDatasetId] = useState("mind2web");
  const [datasetSubset, setDatasetSubset] = useState(50);
  const [datasetInfo, setDatasetInfo] = useState<Array<{ id: string; name: string; taskCount: number; avgTokensPerTask: number; requiresDocker: boolean; requiresCredentials: boolean; description: string }>>([]);
  const [datasetBaseUrl, setDatasetBaseUrl] = useState("");
  // Parallelism
  const [siteConcurrency, setSiteConcurrency] = useState(2);
  const [methodParallel, setMethodParallel] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadSites();
    loadHistory();
    loadMultiHistory();
    fetch(`${API_BASE}/api/benchmark/datasets`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.datasets) setDatasetInfo(d.datasets); })
      .catch(() => {});
    // Reconnect to running benchmark if page was refreshed
    const savedBenchId = localStorage.getItem("activeBenchmarkId");
    const savedMulti = localStorage.getItem("activeBenchmarkMulti") === "true";
    if (savedBenchId) {
      // Check if it's still running
      fetch(`${API_BASE}/api/benchmark/status/${savedBenchId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((d) => {
          if (d && d.status !== "done" && d.status !== "error") {
            pollBenchmark(savedBenchId, d.tasksTotal || 0, savedMulti);
          } else {
            localStorage.removeItem("activeBenchmarkId");
            localStorage.removeItem("activeBenchmarkMulti");
          }
        })
        .catch(() => {
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
        });
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSites() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites`);
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch { /* ignore */ }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.runs || []);
      }
    } catch { /* ignore */ }
  }

  async function loadMultiHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/multi/history`);
      if (res.ok) {
        const data = await res.json();
        setMultiHistory(data.runs || []);
      }
    } catch { /* ignore */ }
  }

  async function deleteRun(runId: string, multi: boolean) {
    const base = multi ? "multi/history" : "history";
    try {
      await fetch(`${API_BASE}/api/benchmark/${base}/${runId}`, { method: "DELETE" });
      if (multi) {
        setMultiHistory((prev) => prev.filter((r) => r.id !== runId));
      } else {
        setHistory((prev) => prev.filter((r) => r.id !== runId));
      }
      if (expandedRun === runId) {
        setExpandedRun(null);
        setExpandedResult(null);
        setExpandedMultiResult(null);
      }
    } catch { /* ignore */ }
  }

  async function toggleExpandRun(runId: string, multi: boolean) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setExpandedResult(null);
      setExpandedMultiResult(null);
      return;
    }
    setExpandedRun(runId);
    setExpandedResult(null);
    setExpandedMultiResult(null);
    const base = multi ? "multi/history" : "history";
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/${base}/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (multi) {
          setExpandedMultiResult(data.result);
        } else {
          setExpandedResult(data.result);
        }
      }
    } catch { /* ignore */ }
  }

  async function addSite() {
    if (!newSiteUrl) return;
    setSiteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newSiteUrl }),
      });
      if (res.ok) {
        setNewSiteUrl("");
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to add site");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setSiteLoading(false);
    }
  }

  async function removeSite(domain: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/sites/${domain}`, { method: "DELETE" });
      await loadSites();
    } catch { /* ignore */ }
  }

  async function addManualTask(domain: string) {
    if (!taskForm.instruction || !taskForm.successCriteria) return;
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites/${domain}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskForm),
      });
      if (res.ok) {
        setAddingTask(null);
        setTaskForm({ instruction: "", successCriteria: "", category: "navigation" });
        await loadSites();
      }
    } catch { /* ignore */ }
  }

  async function removeTask(domain: string, taskId: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/sites/${domain}/tasks/${taskId}`, { method: "DELETE" });
      await loadSites();
    } catch { /* ignore */ }
  }

  async function generateTasks(url: string, domain: string) {
    setGenerating(domain);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/tasks/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, count: 3 }),
      });
      if (res.ok) {
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Task generation failed");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setGenerating(null);
    }
  }

  async function generateSitesWithAI() {
    setGeneratingSites(true);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: siteCount }),
      });
      if (res.ok) {
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Site generation failed");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setGeneratingSites(false);
    }
  }

  function toggleMethod(method: DocMethod) {
    setSelectedMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  async function handleRun(useConfigured: boolean) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setStatus({ state: "running", phase: "Starting..." });

    try {
      const res = await fetch(`${API_BASE}/api/benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useConfigured ? { useConfiguredSites: true } : { useSampleTasks: true }
        ),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      pollBenchmark(data.benchId, data.tasksTotal, false);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  async function handleMultiMethodRun(generateNewSites: boolean) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (selectedMethods.length === 0) {
      alert("Select at least one method to test.");
      return;
    }

    setStatus({ state: "running", phase: "Starting multi-method benchmark...", multiMethod: true });

    try {
      const isDataset = taskSource === "dataset";
      const selectedDataset = datasetInfo.find((d) => d.id === datasetId);
      const res = await fetch(`${API_BASE}/api/benchmark/multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          methods: selectedMethods,
          generateSites: isDataset ? false : generateNewSites,
          useConfiguredSites: isDataset ? false : !generateNewSites,
          siteCount: !isDataset && generateNewSites ? siteCount : undefined,
          tasksPerSite: isDataset ? undefined : tasksPerSite,
          runsPerTask: runsPerTask > 1 ? runsPerTask : undefined,
          verifyResults: verifyResults || undefined,
          siteConcurrency: siteConcurrency !== 2 ? siteConcurrency : undefined,
          methodParallel: !methodParallel ? false : undefined,
          datasetConfig: isDataset ? {
            source: datasetId,
            subset: datasetSubset,
            ...(selectedDataset?.requiresDocker && datasetBaseUrl ? { dockerBaseUrl: datasetBaseUrl } : {}),
            ...(selectedDataset?.requiresCredentials && datasetBaseUrl ? { credentials: { baseUrl: datasetBaseUrl } } : {}),
          } : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      pollBenchmark(data.benchId, 0, true);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  function pollBenchmark(benchId: string, initialTotal: number, multi: boolean) {
    // Save to localStorage so we can reconnect after page refresh
    localStorage.setItem("activeBenchmarkId", benchId);
    localStorage.setItem("activeBenchmarkMulti", String(multi));

    setStatus({
      state: "running",
      benchId,
      phase: "Reconnecting...",
      tasksTotal: initialTotal,
      tasksCompleted: 0,
      multiMethod: multi,
    });

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_BENCHMARK_POLL_ATTEMPTS) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        localStorage.removeItem("activeBenchmarkId");
        localStorage.removeItem("activeBenchmarkMulti");
        setStatus((prev) => ({ ...prev, state: "error", error: "Benchmark timed out after 4 hours" }));
        return;
      }

      try {
        const statusRes = await fetch(`${API_BASE}/api/benchmark/status/${benchId}`);
        if (!statusRes.ok) return;

        const d = await statusRes.json();

        if (d.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
          if (d.multiResult) {
            setStatus({ state: "done", benchId, multiMethod: true, multiResult: d.multiResult });
            loadMultiHistory();
          } else {
            setStatus({ state: "done", benchId, result: d.result });
            loadHistory();
          }
          loadSites();
        } else if (d.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
          setStatus({ state: "error", error: d.error });
        } else {
          const phaseLabel = d.currentSite && d.currentMethod
            ? `Testing ${d.currentSite} with ${DOC_METHOD_LABELS[d.currentMethod as DocMethod] || d.currentMethod}...`
            : d.status === "generating-docs"
            ? `Generating documentation${d.currentSite ? ` for ${d.currentSite}` : ""}...`
            : d.status === "generating-tasks"
            ? `Generating tasks${d.currentSite ? ` for ${d.currentSite}` : ""}...`
            : d.status === "running-baseline"
            ? "Running baseline (no docs)..."
            : d.status === "running-with-docs"
            ? "Running with documentation..."
            : d.status === "running"
            ? "Running benchmark..."
            : "Processing...";

          setStatus((prev) => ({
            ...prev,
            phase: phaseLabel,
            tasksTotal: d.tasksTotal || prev.tasksTotal,
            tasksCompleted: d.tasksCompleted ?? prev.tasksCompleted,
            currentSite: d.currentSite,
            currentMethod: d.currentMethod,
          }));
        }
      } catch { /* Keep polling */ }
    }, 3000);
  }

  const totalConfiguredTasks = sites.reduce((sum, s) => sum + s.tasks.length, 0);

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        Multi-method benchmark using Claude CUA (Computer Use Agent). Compare different
        documentation injection strategies across diverse websites.
      </p>

      {/* Setup */}
      {status.state === "idle" && (
        <>
          {/* Multi-Method Configuration */}
          <div
            style={{
              backgroundColor: "#111",
              border: "1px solid #222",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Multi-Method Benchmark
            </h3>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              Test all doc injection methods simultaneously across multiple sites. AI generates a diverse site list, crawls and documents each site, then benchmarks every method.
            </p>

            {/* Method Selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 }}>
                Methods to test:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ALL_DOC_METHODS.map((method) => (
                  <button
                    key={method}
                    onClick={() => toggleMethod(method)}
                    title={DOC_METHOD_DESCRIPTIONS[method]}
                    style={{
                      ...btnStyle,
                      fontSize: 12,
                      padding: "6px 12px",
                      backgroundColor: selectedMethods.includes(method) ? "#1a2a4a" : "#1a1a1a",
                      color: selectedMethods.includes(method) ? "#3b82f6" : "#888",
                      border: selectedMethods.includes(method) ? "1px solid #3b82f6" : "1px solid #333",
                    }}
                  >
                    {DOC_METHOD_LABELS[method]}
                  </button>
                ))}
              </div>
              {/* Method descriptions legend */}
              <div style={{
                marginTop: 10,
                padding: "10px 12px",
                backgroundColor: "#111",
                borderRadius: 6,
                border: "1px solid #222",
                fontSize: 12,
                lineHeight: 1.6,
                color: "#888",
              }}>
                {selectedMethods.map((method) => (
                  <div key={method} style={{ marginBottom: 4 }}>
                    <span style={{ color: METHOD_COLORS[method] || "#ccc", fontWeight: 600 }}>
                      {DOC_METHOD_LABELS[method]}
                    </span>
                    {" \u2014 "}
                    {DOC_METHOD_DESCRIPTIONS[method]}
                  </div>
                ))}
              </div>
            </div>

            {/* Task Source */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 10 }}>
                Task Source:
              </label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["custom", "dataset"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setTaskSource(src)}
                    style={{
                      ...btnStyle,
                      fontSize: 13,
                      padding: "7px 16px",
                      backgroundColor: taskSource === src ? "#1a2a4a" : "#1a1a1a",
                      color: taskSource === src ? "#3b82f6" : "#888",
                      border: taskSource === src ? "1px solid #3b82f6" : "1px solid #333",
                      fontWeight: taskSource === src ? 600 : 400,
                    }}
                  >
                    {src === "custom" ? "Custom Sites" : "Industry Benchmark"}
                  </button>
                ))}
              </div>

              {taskSource === "dataset" && (
                <div style={{ backgroundColor: "#0a0a0a", border: "1px solid #1e3a5f", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ flex: "1 1 220px" }}>
                      <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>Dataset:</label>
                      <select
                        value={datasetId}
                        onChange={(e) => setDatasetId(e.target.value)}
                        style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", width: "100%" }}
                      >
                        {datasetInfo.length > 0
                          ? datasetInfo.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.taskCount.toLocaleString()} tasks)
                                {d.requiresDocker ? " [Docker]" : ""}
                                {d.requiresCredentials ? " [SaaS]" : ""}
                              </option>
                            ))
                          : [
                              <option key="mind2web" value="mind2web">Mind2Web Online (300 tasks)</option>,
                              <option key="webbench" value="webbench">WebBench 2025 (2,454 tasks)</option>,
                              <option key="webarena" value="webarena">WebArena-Verified (812 tasks) [Docker]</option>,
                              <option key="webchore-arena" value="webchore-arena">WebChoreArena (532 tasks) [Docker]</option>,
                              <option key="visual-webarena" value="visual-webarena">VisualWebArena (910 tasks) [Docker]</option>,
                              <option key="workarena" value="workarena">WorkArena (29 tasks) [SaaS]</option>,
                            ]}
                      </select>
                    </div>
                    <div>
                      <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>Tasks to run:</label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={datasetSubset}
                        onChange={(e) => setDatasetSubset(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                        style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", width: 90 }}
                      />
                    </div>
                  </div>
                  {/* Dataset description */}
                  {(() => {
                    const info = datasetInfo.find((d) => d.id === datasetId);
                    if (!info) return null;
                    return (
                      <p style={{ color: "#666", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                        {info.description}
                        {info.requiresDocker && (
                          <span style={{ color: "#f59e0b", marginLeft: 6 }}>
                            Requires Docker. Setup: <code style={{ fontSize: 11 }}>github.com/{info.id === "webarena" ? "web-arena-x/webarena" : info.id === "webchore-arena" ? "WebChoreArena/WebChoreArena" : "web-arena-x/visualwebarena"}</code>
                          </span>
                        )}
                        {info.requiresCredentials && (
                          <span style={{ color: "#f59e0b", marginLeft: 6 }}>Requires ServiceNow instance.</span>
                        )}
                      </p>
                    );
                  })()}
                  {/* Base URL for Docker/SaaS datasets */}
                  {(() => {
                    const info = datasetInfo.find((d) => d.id === datasetId);
                    if (!info?.requiresDocker && !info?.requiresCredentials) return null;
                    return (
                      <div>
                        <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>
                          {info?.requiresDocker ? "Docker Base URL:" : "ServiceNow Instance URL:"}
                        </label>
                        <input
                          type="text"
                          value={datasetBaseUrl}
                          onChange={(e) => setDatasetBaseUrl(e.target.value)}
                          placeholder={info?.requiresDocker ? "http://localhost" : "https://dev12345.service-now.com"}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", width: "100%", maxWidth: 400 }}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Site Count & Tasks Per Site — hidden in dataset mode */}
            {taskSource === "custom" && (
              <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
                <div>
                  <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
                    Number of sites:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={siteCount}
                    onChange={(e) => setSiteCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    style={{ ...inputStyle, fontSize: 14, padding: "8px 12px", width: 80 }}
                  />
                </div>
                <div>
                  <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
                    Tasks per site:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={tasksPerSite}
                    onChange={(e) => setTasksPerSite(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                    style={{ ...inputStyle, fontSize: 14, padding: "8px 12px", width: 80 }}
                  />
                </div>
                <div>
                  <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
                    Runs per task:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={runsPerTask}
                    onChange={(e) => setRunsPerTask(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                    style={{ ...inputStyle, fontSize: 14, padding: "8px 12px", width: 80 }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <span style={{ color: "#666", fontSize: 12, paddingBottom: 10 }}>
                    Total CUA executions: {siteCount * tasksPerSite * selectedMethods.length * runsPerTask} ({siteCount} sites x {tasksPerSite} tasks x {selectedMethods.length} methods{runsPerTask > 1 ? ` x ${runsPerTask} runs` : ""})
                  </span>
                </div>
              </div>
            )}

            {/* Reliability Options */}
            <div style={{ display: "flex", gap: 24, marginBottom: 20, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={verifyResults}
                  onChange={(e) => setVerifyResults(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#3b82f6" }}
                />
                <span style={{ color: "#ccc", fontSize: 13 }}>Automated verification</span>
              </label>
              <span style={{ color: "#666", fontSize: 12 }}>
                {verifyResults ? "Independent LLM judges each result (adds ~$0.01/task)" : "Agent self-reports success/failure"}
                {runsPerTask > 1 ? ` · ${runsPerTask} runs per task with majority vote` : ""}
              </span>
            </div>

            {/* Cost Estimate Card */}
            {selectedMethods.length > 0 && (() => {
              const taskCount = taskSource === "dataset"
                ? datasetSubset
                : siteCount * tasksPerSite;
              const avgTokensOverride = taskSource === "dataset"
                ? datasetInfo.find((d) => d.id === datasetId)?.avgTokensPerTask
                : undefined;
              const estimate = computeEstimatedCost(selectedMethods as import("../lib/types").DocMethod[], taskCount, avgTokensOverride);
              const concurrencyWarning = siteConcurrency * selectedMethods.length > 20;
              return (
                <div style={{
                  backgroundColor: "#0a0f1a",
                  border: "1px solid #1e3a5f",
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 20,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#93c5fd" }}>
                      Estimated Cost — {taskCount} tasks × {selectedMethods.length} methods
                    </span>
                    {runsPerTask > 1 && (
                      <span style={{ fontSize: 11, color: "#666" }}>per-run avg (×{runsPerTask} runs)</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 32, marginBottom: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ color: "#888", fontSize: 11, marginBottom: 2 }}>Without caching</div>
                      <div style={{ fontSize: 18, fontWeight: 600, color: "#ededed" }}>{formatUsd(estimate.uncachedTotal)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#888", fontSize: 11, marginBottom: 2 }}>With prompt caching</div>
                      <div style={{ fontSize: 18, fontWeight: 600, color: "#22c55e" }}>{formatUsd(estimate.cachedTotal)} <span style={{ fontSize: 12, color: "#4ade80", fontWeight: 400 }}>~50% savings</span></div>
                    </div>
                  </div>
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ color: "#555", fontSize: 12, cursor: "pointer", userSelect: "none" }}>Per-method breakdown</summary>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                      {selectedMethods.map((m) => (
                        <div key={m} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#777" }}>
                          <span style={{ color: METHOD_COLORS[m as import("../lib/types").DocMethod] || "#888" }}>{DOC_METHOD_LABELS[m as import("../lib/types").DocMethod]}</span>
                          <span>{formatUsd(estimate.perMethod[m as import("../lib/types").DocMethod] ?? 0)} ({formatUsd((estimate.perMethod[m as import("../lib/types").DocMethod] ?? 0) / taskCount)}/task)</span>
                        </div>
                      ))}
                    </div>
                  </details>
                  {concurrencyWarning && (
                    <div style={{ marginTop: 8, color: "#f59e0b", fontSize: 12 }}>
                      ⚠ High concurrency ({siteConcurrency} sites × {selectedMethods.length} methods = {siteConcurrency * selectedMethods.length} simultaneous API calls). May hit rate limits.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Advanced: Parallelism Config */}
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ ...btnStyle, fontSize: 12, padding: "5px 12px", color: "#666", border: "1px solid #222" }}
              >
                {showAdvanced ? "▲" : "▼"} Advanced Options
              </button>
              {showAdvanced && (
                <div style={{ marginTop: 12, padding: 16, backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 8, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>
                      Site concurrency (1–8):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={siteConcurrency}
                      onChange={(e) => setSiteConcurrency(Math.max(1, Math.min(8, parseInt(e.target.value) || 2)))}
                      style={{ ...inputStyle, fontSize: 13, padding: "7px 10px", width: 70 }}
                    />
                  </div>
                  <div>
                    <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>
                      Method execution:
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {([true, false] as const).map((parallel) => (
                        <button
                          key={String(parallel)}
                          onClick={() => setMethodParallel(parallel)}
                          style={{
                            ...btnStyle,
                            fontSize: 12,
                            padding: "5px 12px",
                            backgroundColor: methodParallel === parallel ? "#1a2a4a" : "#1a1a1a",
                            color: methodParallel === parallel ? "#3b82f6" : "#666",
                            border: methodParallel === parallel ? "1px solid #3b82f6" : "1px solid #333",
                          }}
                        >
                          {parallel ? "Parallel" : "Sequential"}
                        </button>
                      ))}
                    </div>
                    <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
                      {methodParallel ? "Methods run in parallel per task (faster)" : "Methods run one at a time (avoids rate limits)"}
                    </div>
                  </div>
                  {taskSource === "dataset" && (
                    <div>
                      <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 6 }}>
                        Runs per task:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={runsPerTask}
                        onChange={(e) => setRunsPerTask(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                        style={{ ...inputStyle, fontSize: 13, padding: "7px 10px", width: 70 }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Run Buttons */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {taskSource === "dataset" ? (
                <button
                  onClick={() => handleMultiMethodRun(false)}
                  style={{ ...primaryBtn(false), fontSize: 14 }}
                >
                  Run {datasetInfo.find((d) => d.id === datasetId)?.name || datasetId} ({datasetSubset} tasks × {selectedMethods.length} methods)
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleMultiMethodRun(true)}
                    style={{ ...primaryBtn(false), fontSize: 14 }}
                  >
                    Generate {siteCount} Sites & Run Benchmark
                  </button>
                  {sites.length > 0 && (
                    <button
                      onClick={() => handleMultiMethodRun(false)}
                      style={{ ...primaryBtn(false), fontSize: 14, backgroundColor: "#333" }}
                    >
                      Run on Configured Sites ({sites.length})
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Site Management */}
          <div
            style={{
              backgroundColor: "#111",
              border: "1px solid #222",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Benchmark Sites & Tasks
            </h3>

            {/* Add site form */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={newSiteUrl}
                onChange={(e) => setNewSiteUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={(e) => e.key === "Enter" && addSite()}
                style={{ ...inputStyle, fontSize: 14, padding: "10px 14px" }}
              />
              <button
                onClick={addSite}
                disabled={siteLoading}
                style={{
                  ...btnStyle,
                  backgroundColor: "#3b82f6",
                  border: "none",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {siteLoading ? "Adding..." : "Add Site"}
              </button>
              <button
                onClick={generateSitesWithAI}
                disabled={generatingSites}
                style={{
                  ...btnStyle,
                  backgroundColor: "#1a1a2e",
                  color: "#a855f7",
                  border: "1px solid #a855f733",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {generatingSites ? "Generating..." : `AI Generate ${siteCount} Sites`}
              </button>
            </div>

            {/* Sites list */}
            {sites.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14, textAlign: "center", padding: 20 }}>
                No sites configured. Add manually or use AI to generate a diverse set.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sites.map((site) => (
                  <div
                    key={site.domain}
                    style={{
                      backgroundColor: "#0a0a0a",
                      border: "1px solid #222",
                      borderRadius: 6,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: site.tasks.length > 0 || addingTask === site.domain ? 12 : 0,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{site.domain}</span>
                        <span style={{ color: "#666", fontSize: 12, marginLeft: 8 }}>
                          {site.tasks.length} task{site.tasks.length !== 1 ? "s" : ""}
                        </span>
                        {site.hasDocumentation && (
                          <span style={{ color: "#22c55e", fontSize: 11, marginLeft: 8, border: "1px solid #22c55e33", padding: "2px 6px", borderRadius: 4 }}>
                            docs cached
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => generateTasks(site.url, site.domain)}
                          disabled={generating === site.domain}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", backgroundColor: "#1a1a2e", color: "#a855f7", border: "1px solid #a855f733" }}
                        >
                          {generating === site.domain ? "Generating..." : "AI Generate Tasks"}
                        </button>
                        <button
                          onClick={() => setAddingTask(addingTask === site.domain ? null : site.domain)}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px" }}
                        >
                          + Task
                        </button>
                        <button
                          onClick={() => removeSite(site.domain)}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {site.tasks.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {site.tasks.map((task) => (
                          <div
                            key={task.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              padding: "8px 12px",
                              backgroundColor: "#111",
                              borderRadius: 4,
                              fontSize: 13,
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ color: "#ededed" }}>{task.instruction}</div>
                              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                                {task.category}
                                {task.source === "ai-generated" && <span style={{ color: "#a855f7", marginLeft: 6 }}>AI</span>}
                                {task.source === "manual" && <span style={{ color: "#3b82f6", marginLeft: 6 }}>manual</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => removeTask(site.domain, task.id)}
                              style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: "0 4px", fontSize: 16 }}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {addingTask === site.domain && (
                      <div style={{ marginTop: 12, padding: 12, backgroundColor: "#111", borderRadius: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                        <input type="text" placeholder="Task instruction" value={taskForm.instruction} onChange={(e) => setTaskForm({ ...taskForm, instruction: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px" }} />
                        <input type="text" placeholder="Success criteria" value={taskForm.successCriteria} onChange={(e) => setTaskForm({ ...taskForm, successCriteria: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px" }} />
                        <div style={{ display: "flex", gap: 8 }}>
                          <select value={taskForm.category} onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", flex: "none", width: 180 }}>
                            <option value="navigation">Navigation</option>
                            <option value="search">Search</option>
                            <option value="form-fill">Form Fill</option>
                            <option value="multi-step">Multi-step</option>
                            <option value="information-extraction">Info Extraction</option>
                          </select>
                          <button onClick={() => addManualTask(site.domain)} style={{ ...btnStyle, fontSize: 13, backgroundColor: "#3b82f6", border: "none", color: "#fff" }}>Add Task</button>
                          <button onClick={() => setAddingTask(null)} style={{ ...btnStyle, fontSize: 13 }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legacy A/B Run buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 32, flexWrap: "wrap" }}>
            {totalConfiguredTasks > 0 && (
              <button onClick={() => handleRun(true)} style={{ ...primaryBtn(false), backgroundColor: "#333", fontSize: 14 }}>
                Run Legacy A/B Benchmark ({totalConfiguredTasks} tasks)
              </button>
            )}
            <button onClick={() => handleRun(false)} style={{ ...primaryBtn(false), backgroundColor: "#333", fontSize: 14 }}>
              Run with Sample Tasks (Legacy)
            </button>
          </div>

          {/* Previous Multi-Method Runs */}
          {multiHistory.length > 0 && (
            <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Previous Multi-Method Runs</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {multiHistory.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  return (
                    <div key={run.id} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                      <div
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => toggleExpandRun(run.id, true)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: "#888", fontSize: 12 }}>{new Date(run.timestamp).toLocaleString()}</span>
                          <span style={{ fontSize: 13 }}>{run.sites} site{run.sites !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{run.totalTasks} total runs</span>
                          <span style={{ fontSize: 12, color: "#3b82f6" }}>{run.methods.length} methods</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRun(run.id, true); }}
                            style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}
                          >
                            Delete
                          </button>
                          <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 16px 16px" }}>
                          {expandedMultiResult ? (
                            <MultiMethodResults result={expandedMultiResult} />
                          ) : (
                            <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>Loading details...</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Previous Legacy Runs */}
          {history.length > 0 && (
            <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Previous A/B Runs (Legacy)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  const successDelta = run.improvement?.successRateDelta;
                  const tokenReduction = run.improvement?.tokenReduction;
                  return (
                    <div key={run.id} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                      <div
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => toggleExpandRun(run.id, false)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: "#888", fontSize: 12 }}>{new Date(run.timestamp).toLocaleString()}</span>
                          <span style={{ fontSize: 13 }}>{run.tasksTotal} task{run.tasksTotal !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{(run.successRateBaseline * 100).toFixed(0)}% baseline</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{(run.successRateWithDocs * 100).toFixed(0)}% w/ docs</span>
                          {successDelta != null && (
                            <span style={{ fontSize: 12, color: successDelta > 0 ? "#22c55e" : successDelta < 0 ? "#ef4444" : "#888", fontWeight: 600 }}>
                              {successDelta > 0 ? "+" : ""}{(successDelta * 100).toFixed(1)}pp
                            </span>
                          )}
                          {tokenReduction != null && (
                            <span style={{ fontSize: 12, color: tokenReduction > 0 ? "#22c55e" : "#ef4444" }}>
                              {tokenReduction > 0 ? "-" : "+"}{Math.abs(tokenReduction).toFixed(0)}% tokens
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button onClick={(e) => { e.stopPropagation(); deleteRun(run.id, false); }} style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}>Delete</button>
                          <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 16px 16px" }}>
                          {expandedResult ? <BenchmarkResults result={expandedResult} /> : <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>Loading details...</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Running */}
      {status.state === "running" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 24, color: "#3b82f6", marginBottom: 12 }}>
            {status.multiMethod ? "Multi-Method Benchmark Running" : "CUA Benchmark Running"}
          </div>
          <p style={{ color: "#888", marginBottom: 8 }}>{status.phase}</p>
          {status.currentSite && (
            <p style={{ color: "#aaa", fontSize: 13, marginBottom: 4 }}>Site: {status.currentSite}</p>
          )}
          {status.tasksTotal != null && status.tasksTotal > 0 && (
            <p style={{ color: "#666", fontSize: 14 }}>
              Progress: {status.tasksCompleted || 0} / {status.tasksTotal} task runs
            </p>
          )}
          <div style={{ width: 300, height: 4, backgroundColor: "#333", borderRadius: 2, margin: "20px auto", overflow: "hidden" }}>
            <div
              style={{
                width: status.tasksTotal && status.tasksTotal > 0
                  ? `${((status.tasksCompleted || 0) / status.tasksTotal) * 100}%`
                  : "5%",
                height: "100%",
                backgroundColor: "#3b82f6",
                borderRadius: 2,
                transition: "width 0.5s",
              }}
            />
          </div>
          <p style={{ color: "#555", fontSize: 12, marginTop: 16 }}>
            Claude CUA is controlling a real browser with screenshots. This may take a while.
          </p>
        </div>
      )}

      {/* Error */}
      {status.state === "error" && (
        <>
          <ErrorBox error={status.error} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
          </div>
        </>
      )}

      {/* Multi-Method Results */}
      {status.state === "done" && status.multiResult && (
        <div>
          <MultiMethodResults result={status.multiResult} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
          </div>
        </div>
      )}

      {/* Legacy Results */}
      {status.state === "done" && status.result && !status.multiResult && (
        <div>
          <BenchmarkResults result={status.result} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
            <button onClick={() => handleRun(totalConfiguredTasks > 0)} style={primaryBtn(false)}>Run Again</button>
          </div>
        </div>
      )}
    </>
  );
}

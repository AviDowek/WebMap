"use client";

import { useState } from "react";
import type { MultiMethodResult, MethodResultData, DocMethod } from "../lib/types";
import { DOC_METHOD_LABELS, DOC_METHOD_DESCRIPTIONS, METHOD_COLORS } from "../lib/constants";
import { cardStyle } from "../lib/styles";

function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd < 0.0001) return "$0.0000";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export default function MultiMethodResults({ result }: { result: MultiMethodResult }) {
  const [expandedSite, setExpandedSite] = useState<string | null>(null);

  const baselineOverall = result.overall.find((m) => m.method === "none");
  const allMethods = result.overall;

  if (!allMethods || allMethods.length === 0) {
    return <div style={{ color: "#888", textAlign: "center", padding: 40 }}>No benchmark results available.</div>;
  }

  const hasCostData = allMethods.some((m) => m.metrics.avgCostUsd !== undefined && m.metrics.avgCostUsd > 0);

  // Compute winners for each category
  const mostAccurate = [...allMethods].sort(
    (a, b) => b.metrics.successRate - a.metrics.successRate || (a.metrics.avgCostUsd ?? a.metrics.avgTokensPerTask) - (b.metrics.avgCostUsd ?? b.metrics.avgTokensPerTask)
  )[0];
  // Most efficient = lowest actual cost (falls back to token count if cost not available)
  const mostEfficient = [...allMethods].sort(
    (a, b) => (a.metrics.avgCostUsd ?? a.metrics.avgTokensPerTask / 1e6) - (b.metrics.avgCostUsd ?? b.metrics.avgTokensPerTask / 1e6)
  )[0];
  const fastest = [...allMethods].sort(
    (a, b) => a.metrics.avgDurationMs - b.metrics.avgDurationMs
  )[0];

  // Best values for highlighting
  const bestSuccessRate = Math.max(...allMethods.map((m) => m.metrics.successRate));
  const bestCost = Math.min(...allMethods.map((m) => m.metrics.avgCostUsd ?? Infinity));
  const bestTokens = Math.min(...allMethods.map((m) => m.metrics.avgTokensPerTask));
  const bestDuration = Math.min(...allMethods.map((m) => m.metrics.avgDurationMs));
  const bestSteps = Math.min(...allMethods.map((m) => m.metrics.avgSteps));

  // Composite score: success 50% + cost-efficiency 30% + speed 20%
  // Uses actual cost if available (rewards cheaper Haiku methods correctly)
  const maxDuration = Math.max(...allMethods.map((m) => m.metrics.avgDurationMs));
  const maxCost = Math.max(...allMethods.map((m) => m.metrics.avgCostUsd ?? m.metrics.avgTokensPerTask / 1e6));
  function compositeScore(m: MethodResultData): number {
    const successNorm = m.metrics.successRate;
    const cost = m.metrics.avgCostUsd ?? (m.metrics.avgTokensPerTask / 1e6);
    const costNorm = maxCost > 0 ? 1 - cost / maxCost : 0;
    const speedNorm = maxDuration > 0 ? 1 - m.metrics.avgDurationMs / maxDuration : 0;
    return successNorm * 0.5 + costNorm * 0.3 + speedNorm * 0.2;
  }
  const scoredMethods = allMethods.map((m) => ({ ...m, score: compositeScore(m) })).sort((a, b) => b.score - a.score);

  // Broken sites (0% across all methods)
  const brokenSites = result.sites.filter((site) =>
    site.methods.every((m) => m.metrics.successRate === 0)
  );
  const workingSites = result.sites.length - brokenSites.length;

  // Per-site win counts (exclude broken sites)
  const winCounts: Record<string, number> = {};
  for (const site of result.sites) {
    if (site.methods.every((m) => m.metrics.successRate === 0)) continue;
    const best = [...site.methods].sort(
      (a, b) => b.metrics.successRate - a.metrics.successRate || (a.metrics.avgCostUsd ?? a.metrics.avgTokensPerTask) - (b.metrics.avgCostUsd ?? b.metrics.avgTokensPerTask)
    )[0];
    if (best) winCounts[best.method] = (winCounts[best.method] || 0) + 1;
  }
  const topWinner = Object.entries(winCounts).sort((a, b) => b[1] - a[1])[0];

  const grandTotalCost = allMethods.reduce((s, m) => s + (m.metrics.totalCostUsd ?? 0), 0);

  // Download handlers
  function downloadJSON() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${result.timestamp.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCSV() {
    const headers = ["Method", "Success Rate", "Avg Tokens", "Avg Duration (s)", "Avg Steps", "Cost/Task", "Total Cost", "Overall Score"];
    const rows = scoredMethods.map((m) => [
      DOC_METHOD_LABELS[m.method] || m.method,
      `${(m.metrics.successRate * 100).toFixed(1)}%`,
      m.metrics.avgTokensPerTask.toFixed(0),
      (m.metrics.avgDurationMs / 1000).toFixed(1),
      m.metrics.avgSteps.toFixed(1),
      formatCost(m.metrics.avgCostUsd),
      formatCost(m.metrics.totalCostUsd),
      (m.score * 100).toFixed(1),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${result.timestamp.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Winner Summary Cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Most Accurate</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: METHOD_COLORS[mostAccurate.method] || "#fff" }}>
            {DOC_METHOD_LABELS[mostAccurate.method]}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginTop: 4 }}>
            {(mostAccurate.metrics.successRate * 100).toFixed(1)}%
          </div>
          {baselineOverall && mostAccurate.method !== "none" && (
            <div style={{ fontSize: 11, color: "#22c55e", marginTop: 2 }}>
              +{((mostAccurate.metrics.successRate - baselineOverall.metrics.successRate) * 100).toFixed(1)}pp vs baseline
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Cheapest</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: METHOD_COLORS[mostEfficient.method] || "#fff" }}>
            {DOC_METHOD_LABELS[mostEfficient.method]}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginTop: 4 }}>
            {mostEfficient.metrics.avgCostUsd !== undefined
              ? formatCost(mostEfficient.metrics.avgCostUsd) + "/task"
              : (mostEfficient.metrics.avgTokensPerTask / 1000).toFixed(0) + "K tokens"}
          </div>
          {baselineOverall && mostEfficient.method !== "none" && (
            <div style={{ fontSize: 11, color: "#22c55e", marginTop: 2 }}>
              {mostEfficient.metrics.avgCostUsd !== undefined && baselineOverall.metrics.avgCostUsd
                ? `${(((mostEfficient.metrics.avgCostUsd - baselineOverall.metrics.avgCostUsd) / baselineOverall.metrics.avgCostUsd) * 100).toFixed(0)}% cost vs baseline`
                : `${(((mostEfficient.metrics.avgTokensPerTask - baselineOverall.metrics.avgTokensPerTask) / baselineOverall.metrics.avgTokensPerTask) * 100).toFixed(0)}% tokens vs baseline`}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Fastest</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: METHOD_COLORS[fastest.method] || "#fff" }}>
            {DOC_METHOD_LABELS[fastest.method]}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginTop: 4 }}>
            {(fastest.metrics.avgDurationMs / 1000).toFixed(1)}s
          </div>
          {baselineOverall && fastest.method !== "none" && baselineOverall.metrics.avgDurationMs > 0 && (
            <div style={{ fontSize: 11, color: "#22c55e", marginTop: 2 }}>
              {((1 - fastest.metrics.avgDurationMs / baselineOverall.metrics.avgDurationMs) * 100).toFixed(0)}% faster
            </div>
          )}
        </div>
        {grandTotalCost > 0 && (
          <div style={cardStyle}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Total Benchmark Cost</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginTop: 4 }}>
              {formatCost(grandTotalCost)}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              {result.methods.length} methods · {result.totalTasks} runs
            </div>
            {result.config?.runsPerTask && result.config.runsPerTask > 1 && (
              <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                Cost = per-run avg (×{result.config.runsPerTask} runs each)
              </div>
            )}
          </div>
        )}
        {/* API Execution card — only shown when programmatic method is in results */}
        {(() => {
          const progMethod = result.overall.find((m) => m.method === "programmatic");
          if (!progMethod || progMethod.metrics.apiSuccessRate == null) return null;
          const apiPct = (progMethod.metrics.apiSuccessRate * 100).toFixed(0);
          const fallbackPct = ((progMethod.metrics.visionFallbackRate ?? 0) * 100).toFixed(0);
          return (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>API Execution</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#14b8a6" }}>
                {apiPct}% API calls
              </div>
              <div style={{ fontSize: 13, color: "#3b82f6", marginTop: 2 }}>
                {fallbackPct}% Vision fallback
              </div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#222", display: "flex" }}>
                <div style={{ width: `${apiPct}%`, backgroundColor: "#22c55e", transition: "width 0.3s" }} />
                <div style={{ width: `${fallbackPct}%`, backgroundColor: "#3b82f6", transition: "width 0.3s" }} />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Overall Method Comparison */}
      <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              Overall Method Comparison
            </h3>
            <p style={{ color: "#888", fontSize: 12, margin: 0 }}>
              {result.sites.length} site{result.sites.length !== 1 ? "s" : ""} &middot; {result.totalTasks} total task runs &middot; {result.methods.length} methods
              {topWinner && (
                <span style={{ marginLeft: 8, color: METHOD_COLORS[topWinner[0] as DocMethod] || "#aaa" }}>
                  &middot; {DOC_METHOD_LABELS[topWinner[0] as DocMethod]} won {topWinner[1]}/{workingSites} sites
                </span>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={downloadJSON} style={{ padding: "6px 12px", fontSize: 12, backgroundColor: "#1a1a1a", color: "#aaa", border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}>
              JSON
            </button>
            <button onClick={downloadCSV} style={{ padding: "6px 12px", fontSize: 12, backgroundColor: "#1a1a1a", color: "#aaa", border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}>
              CSV
            </button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}>Method</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Success Rate</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Tokens</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Duration</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Steps</th>
              {hasCostData && <th style={{ textAlign: "center", padding: "10px 12px" }}>Cost/Task</th>}
              {hasCostData && <th style={{ textAlign: "center", padding: "10px 12px" }}>Total Cost</th>}
              {result.methods.includes("programmatic") && <th style={{ textAlign: "center", padding: "10px 12px" }}>API %</th>}
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Score</th>
              {baselineOverall && <th style={{ textAlign: "center", padding: "10px 12px" }}>vs Baseline</th>}
            </tr>
          </thead>
          <tbody>
            {scoredMethods.map((mr, i) => {
              const successDelta = baselineOverall && mr.method !== "none"
                ? mr.metrics.successRate - baselineOverall.metrics.successRate
                : null;
              const costDelta = hasCostData && baselineOverall && mr.method !== "none" && baselineOverall.metrics.avgCostUsd && mr.metrics.avgCostUsd
                ? ((mr.metrics.avgCostUsd - baselineOverall.metrics.avgCostUsd) / baselineOverall.metrics.avgCostUsd) * 100
                : null;
              const tokenDelta = !hasCostData && baselineOverall && mr.method !== "none" && baselineOverall.metrics.avgTokensPerTask > 0
                ? ((mr.metrics.avgTokensPerTask - baselineOverall.metrics.avgTokensPerTask) / baselineOverall.metrics.avgTokensPerTask) * 100
                : null;

              const isBestSuccess = mr.metrics.successRate === bestSuccessRate;
              const isBestCost = hasCostData && mr.metrics.avgCostUsd !== undefined && mr.metrics.avgCostUsd === bestCost;
              const isBestTokens = !hasCostData && mr.metrics.avgTokensPerTask === bestTokens;
              const isBestDuration = mr.metrics.avgDurationMs === bestDuration;
              const isBestSteps = mr.metrics.avgSteps === bestSteps;
              const isTopScore = i === 0;

              return (
                <tr key={mr.method} style={{ borderBottom: "1px solid #222", backgroundColor: isTopScore ? "rgba(34, 197, 94, 0.05)" : i % 2 === 0 ? "transparent" : "#0a0a0a" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }} title={DOC_METHOD_DESCRIPTIONS[mr.method]}>
                    <span style={{ color: METHOD_COLORS[mr.method] || "#aaa" }}>
                      {isTopScore ? "★ " : ""}{DOC_METHOD_LABELS[mr.method]}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: isBestSuccess ? 700 : 400, color: isBestSuccess ? "#22c55e" : undefined }}>
                    {(mr.metrics.successRate * 100).toFixed(1)}%
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: isBestTokens ? 700 : 400, color: isBestTokens ? "#22c55e" : undefined }}>
                    {mr.metrics.avgTokensPerTask.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: isBestDuration ? 700 : 400, color: isBestDuration ? "#22c55e" : undefined }}>
                    {(mr.metrics.avgDurationMs / 1000).toFixed(1)}s
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: isBestSteps ? 700 : 400, color: isBestSteps ? "#22c55e" : undefined }}>
                    {mr.metrics.avgSteps.toFixed(1)}
                  </td>
                  {hasCostData && (
                    <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: isBestCost ? 700 : 400, color: isBestCost ? "#22c55e" : "#aaa" }}>
                      {formatCost(mr.metrics.avgCostUsd)}
                    </td>
                  )}
                  {hasCostData && (
                    <td style={{ textAlign: "center", padding: "10px 12px", color: "#666", fontSize: 12 }}>
                      {formatCost(mr.metrics.totalCostUsd)}
                    </td>
                  )}
                  {result.methods.includes("programmatic") && (
                    <td style={{ textAlign: "center", padding: "10px 12px", color: mr.metrics.apiSuccessRate != null ? "#14b8a6" : "#555" }}>
                      {mr.metrics.apiSuccessRate != null ? `${(mr.metrics.apiSuccessRate * 100).toFixed(0)}%` : "—"}
                    </td>
                  )}
                  <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: 600, color: isTopScore ? "#22c55e" : "#aaa" }}>
                    {(mr.score * 100).toFixed(1)}
                  </td>
                  {baselineOverall && (
                    <td style={{ textAlign: "center", padding: "10px 12px" }}>
                      {mr.method === "none" ? (
                        <span style={{ color: "#555" }}>--</span>
                      ) : (
                        <span>
                          <span style={{ color: successDelta != null && successDelta > 0 ? "#22c55e" : successDelta != null && successDelta < 0 ? "#ef4444" : "#888", fontWeight: 600, display: "block" }}>
                            {successDelta != null ? `${successDelta > 0 ? "+" : ""}${(successDelta * 100).toFixed(1)}pp` : ""}
                          </span>
                          {costDelta !== null ? (
                            <span style={{ color: costDelta < 0 ? "#22c55e" : "#ef4444", fontSize: 11 }}>
                              {costDelta > 0 ? "+" : ""}{costDelta.toFixed(0)}% cost
                            </span>
                          ) : tokenDelta !== null ? (
                            <span style={{ color: tokenDelta < 0 ? "#22c55e" : tokenDelta > 0 ? "#ef4444" : "#888", fontSize: 11 }}>
                              {tokenDelta > 0 ? "+" : ""}{tokenDelta.toFixed(0)}% tokens
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasCostData && (
          <p style={{ color: "#555", fontSize: 11, marginTop: 8, margin: "8px 0 0" }}>
            Haiku: $1/$5 per MTok · Sonnet: $3/$15 per MTok · Cache reads: 10% · Cache writes: 125% · Verification excluded
          </p>
        )}
      </div>

      {/* Per-Site Breakdown */}
      <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          Per-Site Breakdown
        </h3>

        {brokenSites.length > 0 && (
          <div style={{ backgroundColor: "#1a1208", border: "1px solid #44370a", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#f59e0b" }}>
            {brokenSites.length} site{brokenSites.length !== 1 ? "s" : ""} failed across all methods (likely anti-bot): {brokenSites.map((s) => s.domain).join(", ")}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {result.sites.map((site) => {
            const isExpanded = expandedSite === site.domain;
            const baseline = site.methods.find((m) => m.method === "none");
            const bestMethod = [...site.methods].sort(
              (a, b) => b.metrics.successRate - a.metrics.successRate || (a.metrics.avgCostUsd ?? a.metrics.avgTokensPerTask) - (b.metrics.avgCostUsd ?? b.metrics.avgTokensPerTask)
            )[0];
            const isBroken = site.methods.every((m) => m.metrics.successRate === 0);

            return (
              <div key={site.domain} style={{ backgroundColor: "#0a0a0a", border: `1px solid ${isBroken ? "#44370a" : "#222"}`, borderRadius: 6, overflow: "hidden", opacity: isBroken ? 0.6 : 1 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                  onClick={() => setExpandedSite(isExpanded ? null : site.domain)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {isBroken ? "⚠ " : ""}{site.domain}
                    </span>
                    {baseline && (
                      <span style={{ fontSize: 12, color: "#888" }}>
                        Baseline: {(baseline.metrics.successRate * 100).toFixed(0)}%
                      </span>
                    )}
                    {!isBroken && (
                      <span style={{ fontSize: 12, color: METHOD_COLORS[bestMethod.method] || "#aaa" }}>
                        Best: {DOC_METHOD_LABELS[bestMethod.method]} ({(bestMethod.metrics.successRate * 100).toFixed(0)}%)
                      </span>
                    )}
                    {isBroken && (
                      <span style={{ fontSize: 11, color: "#f59e0b" }}>All methods failed</span>
                    )}
                  </div>
                  <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "▲" : "▼"}</span>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 16px 16px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>Method</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Success</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Tokens</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Duration</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Steps</th>
                          {hasCostData && <th style={{ textAlign: "center", padding: "8px 10px" }}>Cost/Task</th>}
                          {hasCostData && <th style={{ textAlign: "center", padding: "8px 10px" }}>Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {site.methods.map((mr, j) => (
                          <tr key={mr.method} style={{ borderBottom: "1px solid #222", backgroundColor: j % 2 === 0 ? "transparent" : "#111" }}>
                            <td style={{ padding: "8px 10px" }}>
                              <span style={{ color: METHOD_COLORS[mr.method] || "#aaa", fontWeight: 600 }}>
                                {DOC_METHOD_LABELS[mr.method]}
                              </span>
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px" }}>
                              <span style={{ color: mr.metrics.successRate >= 0.5 ? "#22c55e" : "#ef4444" }}>
                                {(mr.metrics.successRate * 100).toFixed(0)}%
                              </span>
                              <span style={{ color: "#555", fontSize: 11, marginLeft: 4 }}>
                                ({mr.tasks.filter((t) => t.success).length}/{mr.tasks.length})
                              </span>
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {mr.metrics.avgTokensPerTask.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {(mr.metrics.avgDurationMs / 1000).toFixed(1)}s
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {mr.metrics.avgSteps.toFixed(1)}
                            </td>
                            {hasCostData && (
                              <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                                {formatCost(mr.metrics.avgCostUsd)}
                              </td>
                            )}
                            {hasCostData && (
                              <td style={{ textAlign: "center", padding: "8px 10px", color: "#666", fontSize: 12 }}>
                                {formatCost(mr.metrics.totalCostUsd)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Per-task detail within site */}
                    <div style={{ marginTop: 12 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8 }}>Task Details</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #333", color: "#666" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Task</th>
                            {site.methods.map((mr) => (
                              <th key={mr.method} style={{ textAlign: "center", padding: "6px 8px", color: METHOD_COLORS[mr.method] }}>
                                {DOC_METHOD_LABELS[mr.method]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {site.methods[0]?.tasks.map((_, taskIdx) => (
                            <tr key={taskIdx} style={{ borderBottom: "1px solid #222" }}>
                              <td style={{ padding: "6px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {site.methods[0].tasks[taskIdx].taskId}
                              </td>
                              {site.methods.map((mr) => {
                                const task = mr.tasks[taskIdx];
                                const hasCascade = task?.cascadeEscalations && task.cascadeEscalations > 0;
                                return (
                                  <td key={mr.method} style={{ textAlign: "center", padding: "6px 8px" }}>
                                    <span style={{ color: task?.success ? "#22c55e" : "#ef4444", fontWeight: 600, fontSize: 11 }}>
                                      {task?.success ? "Pass" : "Fail"}
                                    </span>
                                    <span style={{ color: "#555", fontSize: 10, marginLeft: 4 }}>
                                      {task ? `${(task.tokensUsed / 1000).toFixed(0)}K` : "--"}
                                    </span>
                                    {task?.estimatedCostUsd !== undefined && (
                                      <span style={{ color: "#444", fontSize: 10, display: "block" }}>
                                        {formatCost(task.estimatedCostUsd)}
                                      </span>
                                    )}
                                    {hasCascade && (
                                      <span style={{ color: "#a78bfa", fontSize: 10, display: "block" }} title={`Escalated to Sonnet ${task.cascadeEscalations}x`}>
                                        ↑{task.cascadeEscalations}×
                                      </span>
                                    )}
                                    {task?.apiCallCount != null && task.apiCallCount + (task.visionFallbackCount ?? 0) > 0 && (
                                      <span style={{ color: "#14b8a6", fontSize: 10, display: "block" }} title={`${task.apiCallCount} API, ${task.visionFallbackCount ?? 0} fallback`}>
                                        {task.apiCallCount}A/{task.visionFallbackCount ?? 0}F
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

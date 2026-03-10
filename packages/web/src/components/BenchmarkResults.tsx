"use client";

import type { BenchmarkStatus } from "../lib/types";

export default function BenchmarkResults({ result }: { result: BenchmarkStatus["result"] }) {
  if (!result) return null;

  const { summary } = result;

  return (
    <>
      {/* Comparison Table */}
      <div
        style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          CUA A/B Comparison
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}>Metric</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Baseline (no docs)</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>With Docs</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Improvement</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid #222" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Success Rate</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.baseline.successRate * 100).toFixed(1)}%
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.withDocs.successRate * 100).toFixed(1)}%
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color:
                    summary.improvement.successRateDelta > 0
                      ? "#22c55e"
                      : summary.improvement.successRateDelta < 0
                      ? "#ef4444"
                      : "#888",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.successRateDelta > 0 ? "+" : ""}
                {(summary.improvement.successRateDelta * 100).toFixed(1)}pp
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #222", backgroundColor: "#0a0a0a" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Tokens/Task</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.baseline.avgTokensPerTask.toFixed(0)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.withDocs.avgTokensPerTask.toFixed(0)}
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color: summary.improvement.tokenReduction > 0 ? "#22c55e" : "#ef4444",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.tokenReduction > 0 ? "-" : "+"}
                {Math.abs(summary.improvement.tokenReduction).toFixed(1)}%
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #222" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Duration</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.baseline.avgDurationMs / 1000).toFixed(1)}s
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.withDocs.avgDurationMs / 1000).toFixed(1)}s
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color: summary.improvement.speedup > 1 ? "#22c55e" : "#ef4444",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.speedup.toFixed(2)}x
              </td>
            </tr>
            <tr style={{ backgroundColor: "#0a0a0a" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Steps</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.baseline.avgSteps.toFixed(1)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.withDocs.avgSteps.toFixed(1)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px", color: "#888" }}>
                {(summary.withDocs.avgSteps - summary.baseline.avgSteps).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Per-task breakdown */}
      <div
        style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          Per-Task Breakdown
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Task</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Baseline</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>With Docs</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Baseline Tokens</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Docs Tokens</th>
            </tr>
          </thead>
          <tbody>
            {result.baseline.map((baseline, i) => {
              const withDocs = result.withDocs[i];
              return (
                <tr
                  key={baseline.taskId}
                  style={{
                    borderBottom: "1px solid #222",
                    backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0a",
                  }}
                >
                  <td style={{ padding: "8px 10px" }}>{baseline.taskId}</td>
                  <td style={{ textAlign: "center", padding: "8px 10px" }}>
                    <span
                      style={{
                        color: baseline.success ? "#22c55e" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {baseline.success ? "Pass" : "Fail"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px" }}>
                    <span
                      style={{
                        color: withDocs?.success ? "#22c55e" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {withDocs?.success ? "Pass" : "Fail"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                    {baseline.tokensUsed.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                    {withDocs?.tokensUsed.toLocaleString() ?? "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

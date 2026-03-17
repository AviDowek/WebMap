"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import type { BatchStatus } from "../lib/types";
import { API_BASE, MAX_POLL_ATTEMPTS } from "../lib/constants";
import { apiHeaders } from "../lib/api";
import { btnStyle, primaryBtn, statusColors } from "../lib/styles";

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

export default function BatchTab() {
  const [urls, setUrls] = useState("");
  const [status, setStatus] = useState<BatchStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (u.startsWith("http") ? u : `https://${u}`));

    if (urlList.length === 0) return;
    if (urlList.length > 20) {
      setStatus({ state: "error", error: "Maximum 20 URLs per batch" });
      return;
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setStatus({ state: "running" });

    try {
      const res = await fetch(`${API_BASE}/api/batch`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ urls: urlList }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      const batchId = data.batchId;
      setStatus({ state: "running", batchId, sites: data.sites });

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS * 2) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setStatus((prev) => ({ ...prev, state: "error", error: "Batch timed out" }));
          return;
        }

        try {
          const statusRes = await fetch(`${API_BASE}/api/batch/status/${batchId}`, { headers: apiHeaders() });
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();

          if (statusData.status === "done" || statusData.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }

          setStatus({
            state: statusData.status === "done" ? "done" : statusData.status === "error" ? "error" : "running",
            batchId,
            sites: statusData.sites,
            error: statusData.error,
          });
        } catch {
          // Keep polling
        }
      }, 3000);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  const completedCount = status.sites?.filter((s) => s.status === "done" || s.status === "error").length || 0;
  const totalCount = status.sites?.length || 0;

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        Test WebMap against multiple websites at once. Enter one URL per line (max 20).
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ maxWidth: 700, margin: "0 auto 32px" }}
      >
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={"https://example.com\nhttps://docs.github.com\nhttps://react.dev"}
          rows={6}
          style={{
            width: "100%",
            padding: "14px 18px",
            fontSize: 14,
            borderRadius: 8,
            border: "1px solid #333",
            backgroundColor: "#1a1a1a",
            color: "#ededed",
            outline: "none",
            resize: "vertical",
            fontFamily: "monospace",
            marginBottom: 12,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={status.state === "running"}
            style={primaryBtn(status.state === "running")}
          >
            {status.state === "running"
              ? `Running... (${completedCount}/${totalCount})`
              : "Run Batch Test"}
          </button>
        </div>
      </form>

      {status.state === "error" && !status.sites && <ErrorBox error={status.error} />}

      {/* Results Table */}
      {status.sites && status.sites.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>URL</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Status</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Pages</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Elements</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Workflows</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Tokens</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {status.sites.map((site, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #222",
                    backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0a",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 12px",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {site.domain}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    <span
                      style={{
                        color: statusColors[site.status] || "#888",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {site.status === "done" ? "Done" : site.status === "error" ? "Error" : site.status === "analyzing" ? "Analyzing" : site.status === "crawling" ? "Crawling" : "Pending"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.pagesFound ?? "\u2014"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.elementsFound ?? "\u2014"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.workflowsFound ?? "\u2014"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.tokensUsed != null ? site.tokensUsed.toLocaleString() : "\u2014"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.durationMs != null ? `${(site.durationMs / 1000).toFixed(1)}s` : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          {status.state === "done" && (
            <div
              style={{
                marginTop: 24,
                padding: 20,
                backgroundColor: "#111",
                borderRadius: 8,
                border: "1px solid #222",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
                Batch Complete
              </div>
              <div style={{ display: "flex", gap: 32, justifyContent: "center", color: "#aaa", fontSize: 14 }}>
                <span>
                  Success:{" "}
                  <strong style={{ color: "#22c55e" }}>
                    {status.sites.filter((s) => s.status === "done").length}
                  </strong>{" "}
                  / {status.sites.length}
                </span>
                <span>
                  Failed:{" "}
                  <strong style={{ color: "#ef4444" }}>
                    {status.sites.filter((s) => s.status === "error").length}
                  </strong>
                </span>
                <span>
                  Total Tokens:{" "}
                  <strong style={{ color: "#ededed" }}>
                    {status.sites
                      .reduce((sum, s) => sum + (s.tokensUsed || 0), 0)
                      .toLocaleString()}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

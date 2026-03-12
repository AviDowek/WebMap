"use client";

import { useState } from "react";
import type { Tab } from "../lib/types";
import { tabStyle } from "../lib/styles";
import GenerateTab from "../components/GenerateTab";
import BatchTab from "../components/BatchTab";
import BenchmarkTab from "../components/BenchmarkTab";
import APIBrowser from "../components/APIBrowser";

export default function Home() {
  const [tab, setTab] = useState<Tab>("generate");

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>
          <span style={{ color: "#3b82f6" }}>Web</span>Map
        </h1>
        <p
          style={{
            color: "#888",
            fontSize: 18,
            maxWidth: 600,
            margin: "0 auto",
          }}
        >
          Generate comprehensive website documentation for AI agents.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 4,
          borderBottom: "1px solid #333",
          marginBottom: 32,
        }}
      >
        <button style={tabStyle(tab === "generate")} onClick={() => setTab("generate")}>
          Generate
        </button>
        <button style={tabStyle(tab === "batch")} onClick={() => setTab("batch")}>
          Batch Test
        </button>
        <button style={tabStyle(tab === "benchmark")} onClick={() => setTab("benchmark")}>
          Benchmark
        </button>
        <button style={tabStyle(tab === "apis")} onClick={() => setTab("apis")}>
          APIs
        </button>
      </div>

      {tab === "generate" && <GenerateTab />}
      {tab === "batch" && <BatchTab />}
      {tab === "benchmark" && <BenchmarkTab />}
      {tab === "apis" && <APIBrowser />}
    </main>
  );
}

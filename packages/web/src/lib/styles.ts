import type React from "react";

// ─── Styles ──────────────────────────────────────────────────────────

export const tabStyle = (active: boolean) => ({
  padding: "10px 24px",
  fontSize: 15,
  fontWeight: active ? 700 : 400,
  borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
  color: active ? "#3b82f6" : "#888",
  background: "none",
  border: "none",
  borderBottomWidth: 2,
  borderBottomStyle: "solid" as const,
  borderBottomColor: active ? "#3b82f6" : "transparent",
  cursor: "pointer",
  transition: "color 0.2s",
});

export const btnStyle = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #333",
  backgroundColor: "#1a1a1a",
  color: "#ededed",
  cursor: "pointer",
  fontSize: 14,
};

export const primaryBtn = (disabled: boolean) => ({
  padding: "14px 28px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 8,
  border: "none",
  backgroundColor: disabled ? "#1e3a5f" : "#3b82f6",
  color: "#fff",
  cursor: disabled ? "wait" : "pointer",
});

export const inputStyle = {
  flex: 1,
  padding: "14px 18px",
  fontSize: 16,
  borderRadius: 8,
  border: "1px solid #333",
  backgroundColor: "#1a1a1a",
  color: "#ededed",
  outline: "none",
};

export const statusColors: Record<string, string> = {
  pending: "#888",
  crawling: "#3b82f6",
  analyzing: "#a855f7",
  done: "#22c55e",
  error: "#ef4444",
};

export const sectionStyle: React.CSSProperties = {
  backgroundColor: "#111",
  border: "1px solid #222",
  borderRadius: 8,
  padding: 24,
  marginBottom: 24,
};

export const cardStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: "#0a0a0a",
  border: "1px solid #222",
  borderRadius: 8,
  padding: "16px 20px",
  textAlign: "center",
  minWidth: 160,
};

export const dangerBtn = {
  ...btnStyle,
  fontSize: 12,
  padding: "4px 10px",
  color: "#ef4444",
  border: "1px solid #ef444433",
};

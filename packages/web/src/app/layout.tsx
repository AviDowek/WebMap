import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WebMap — AI Agent Website Documentation",
  description:
    "Generate comprehensive website documentation for AI agents. Crawl any site and get structured markdown docs with interactive elements, forms, and workflows.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: "#0a0a0a",
          color: "#ededed",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}

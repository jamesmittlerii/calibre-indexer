import type { Metadata } from "next";
import { Figtree, Literata } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Calibre Indexer",
  description: "Search and download EPUBs across Calibre content servers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header
          style={{
            borderBottom: "1px solid var(--line)",
            background: "rgba(255,253,248,0.85)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              padding: "1rem 1.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <Link href="/" style={{ fontFamily: "var(--font-display)" }}>
              <span style={{ fontSize: "1.35rem", fontWeight: 600 }}>
                Calibre Indexer
              </span>
            </Link>
            <nav style={{ display: "flex", gap: "1.25rem", color: "var(--muted)" }}>
              <Link href="/">Search</Link>
              <Link href="/servers">Servers</Link>
            </nav>
          </div>
        </header>
        <main style={{ flex: 1 }}>{children}</main>
      </body>
    </html>
  );
}

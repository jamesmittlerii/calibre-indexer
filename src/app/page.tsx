"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Book = {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  tags: string | null;
  publisher: string | null;
  description: string | null;
  has_epub: number;
  server_url?: string;
  server_name?: string | null;
  library_id: string;
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookCount, setBookCount] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch("/api/index")
      .then((r) => r.json())
      .then((data) => setBookCount(data.bookCount ?? 0))
      .catch(() => setBookCount(null));
  }, []);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setBooks(data.books ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.25rem 4rem" }}>
      <section style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2rem, 4vw, 2.75rem)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 0.5rem",
          }}
        >
          Find a book
        </h1>
        <p style={{ color: "var(--muted)", margin: "0 0 1.5rem", maxWidth: 40 * 16 }}>
          Search EPUB titles across your Calibre servers, then download a match.
          {bookCount !== null
            ? ` ${bookCount.toLocaleString()} EPUBs indexed.`
            : null}
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, author, tags…"
            aria-label="Search books"
            style={{
              flex: "1 1 280px",
              padding: "0.85rem 1rem",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              boxShadow: "var(--shadow)",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "0.85rem 1.25rem",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: loading ? "wait" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </section>

      {error ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>{error}</p>
      ) : null}

      {!searched && bookCount === 0 ? (
        <div
          style={{
            padding: "1.25rem",
            borderRadius: 12,
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          <p style={{ margin: 0 }}>
            No books indexed yet. Add Calibre server URLs on the{" "}
            <a href="/servers" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              Servers
            </a>{" "}
            page and run an index.
          </p>
        </div>
      ) : null}

      {searched && !loading && books.length === 0 && !error ? (
        <p style={{ color: "var(--muted)" }}>No matches.</p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.85rem" }}>
        {books.map((book) => (
          <li
            key={book.id}
            style={{
              padding: "1rem 1.15rem",
              borderRadius: 12,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "1.15rem",
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {book.title}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.95rem" }}>
                {book.authors || "Unknown author"}
                {book.series ? ` · ${book.series}` : ""}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 6 }}>
                {book.server_name || book.server_url}
                {book.tags ? ` · ${book.tags}` : ""}
              </div>
              {book.description ? (
                <p
                  style={{
                    margin: "0.65rem 0 0",
                    color: "var(--ink)",
                    opacity: 0.85,
                    fontSize: "0.9rem",
                    lineHeight: 1.45,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {book.description}
                </p>
              ) : null}
            </div>
            <div>
              <a
                href={`/api/download/${book.id}`}
                style={{
                  display: "inline-block",
                  padding: "0.65rem 1rem",
                  borderRadius: 8,
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                Get EPUB
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

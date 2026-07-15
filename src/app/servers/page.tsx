"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

type ServerStats = {
  id: number;
  url: string;
  name: string | null;
  username: string | null;
  created_at: string;
  last_status: "ok" | "error" | "indexing" | "pending" | null;
  last_error: string | null;
  last_indexed_at: string | null;
  book_count: number;
};

type IndexJob = {
  status: string;
  message: string | null;
  books_indexed: number;
  started_at: string | null;
  finished_at: string | null;
};

function StatusIcon({ status }: { status: ServerStats["last_status"] }) {
  const tone =
    status === "ok"
      ? { bg: "#e6f4ea", fg: "#1e7a3a", label: "OK", symbol: "✓" }
      : status === "error"
        ? { bg: "#fce8e6", fg: "#b3261e", label: "Failed", symbol: "✕" }
        : status === "indexing"
          ? { bg: "#e8f0fe", fg: "#1a56db", label: "Indexing", symbol: "↻" }
          : { bg: "#f1efe8", fg: "#6b6560", label: "Not indexed", symbol: "○" };

  return (
    <span
      title={tone.label}
      aria-label={tone.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        fontWeight: 700,
        fontSize: "0.85rem",
        flexShrink: 0,
      }}
    >
      {tone.symbol}
    </span>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString();
}

export default function ServersPage() {
  const [servers, setServers] = useState<ServerStats[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [job, setJob] = useState<IndexJob | null>(null);
  const [bookCount, setBookCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [serversRes, indexRes] = await Promise.all([
      fetch("/api/servers"),
      fetch("/api/index"),
    ]);
    const serversData = await serversRes.json();
    const indexData = await indexRes.json();
    setServers(serversData.servers ?? []);
    setJob(indexData.job ?? null);
    setBookCount(indexData.bookCount ?? 0);
  }, []);

  useEffect(() => {
    void refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load")
    );
  }, [refresh]);

  useEffect(() => {
    if (job?.status !== "running") return;
    const id = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(id);
  }, [job?.status, refresh]);

  const summary = useMemo(() => {
    const ok = servers.filter((s) => s.last_status === "ok").length;
    const failed = servers.filter((s) => s.last_status === "error").length;
    const pending = servers.filter(
      (s) => !s.last_status || s.last_status === "pending"
    ).length;
    const indexing = servers.filter((s) => s.last_status === "indexing").length;
    return { ok, failed, pending, indexing };
  }, [servers]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name, username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add server");
      setUrl("");
      setName("");
      setUsername("");
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  async function startIndex(serverId?: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverId != null ? { serverId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Index failed");
      setJob(data.job ?? null);
      setBookCount(data.bookCount ?? 0);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Index failed");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const indexing = job?.status === "running";
  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "0.75rem 0.9rem",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "var(--panel)",
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.25rem 4rem" }}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(2rem, 4vw, 2.5rem)",
          margin: "0 0 0.5rem",
        }}
      >
        Calibre servers
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Add content server URLs, then rebuild the local SQLite search index.
      </p>

      {error ? (
        <p style={{ color: "var(--danger)" }}>{error}</p>
      ) : null}

      <section
        style={{
          padding: "1.25rem",
          borderRadius: 14,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
          marginBottom: "1.5rem",
        }}
      >
        <form
          onSubmit={onAdd}
          style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr 1fr" }}
        >
          <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Server URL</span>
            <input
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.10:8080"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Display name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Home library"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </label>
          <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: "0.75rem 1.1rem",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Add server
            </button>
          </div>
        </form>
      </section>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.25rem",
          padding: "1rem 1.15rem",
          borderRadius: 12,
          background: "var(--bg-accent)",
          border: "1px solid var(--line)",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>
            {bookCount.toLocaleString()} EPUBs · {servers.length} servers
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {summary.ok} ok · {summary.failed} failed · {summary.pending} pending
            {summary.indexing ? ` · ${summary.indexing} indexing` : ""}
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
            Status: {job?.status ?? "idle"}
            {job?.message ? ` — ${job.message}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void startIndex()}
          disabled={busy || indexing || servers.length === 0}
          style={{
            padding: "0.75rem 1.1rem",
            borderRadius: 10,
            border: "none",
            background: "var(--ink)",
            color: "#fff",
            fontWeight: 600,
            cursor: busy || indexing || servers.length === 0 ? "not-allowed" : "pointer",
            opacity: busy || indexing || servers.length === 0 ? 0.6 : 1,
          }}
        >
          {indexing ? "Indexing…" : "Rebuild all"}
        </button>
      </section>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
        {servers.length === 0 ? (
          <li style={{ color: "var(--muted)" }}>No servers yet.</li>
        ) : (
          servers.map((server) => (
            <li
              key={server.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "0.85rem",
                alignItems: "center",
                padding: "1rem 1.1rem",
                borderRadius: 12,
                background: "var(--panel)",
                border: "1px solid var(--line)",
              }}
            >
              <StatusIcon status={server.last_status} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem 1rem",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {server.name || "Untitled server"}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {server.book_count.toLocaleString()}{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                      EPUBs
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.9rem",
                    wordBreak: "break-all",
                    marginTop: 2,
                  }}
                >
                  {server.url}
                  {server.username ? ` · auth as ${server.username}` : ""}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 4 }}>
                  Last index: {formatWhen(server.last_indexed_at)}
                  {server.last_status === "error" && server.last_error
                    ? ` · ${server.last_error}`
                    : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void startIndex(server.id)}
                  disabled={busy || indexing}
                  style={{
                    padding: "0.55rem 0.9rem",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--bg-accent)",
                    color: "var(--ink)",
                    cursor: busy || indexing ? "not-allowed" : "pointer",
                    opacity: busy || indexing ? 0.6 : 1,
                    fontWeight: 600,
                  }}
                >
                  Reindex
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(server.id)}
                  disabled={busy || server.last_status === "indexing"}
                  title={
                    server.last_status === "indexing"
                      ? "Wait until this server finishes indexing"
                      : "Remove server and its indexed books"
                  }
                  style={{
                    padding: "0.55rem 0.9rem",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--danger)",
                    cursor:
                      busy || server.last_status === "indexing"
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      busy || server.last_status === "indexing" ? 0.6 : 1,
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

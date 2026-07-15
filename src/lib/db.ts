import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "index.db");

export type ServerStatus = "ok" | "error" | "indexing" | "pending";

export type Server = {
  id: number;
  url: string;
  name: string | null;
  username: string | null;
  password: string | null;
  created_at: string;
  last_status: ServerStatus | null;
  last_error: string | null;
  last_indexed_at: string | null;
};

export type ServerStats = Omit<Server, "password"> & {
  book_count: number;
};

export type Book = {
  id: number;
  server_id: number;
  library_id: string;
  calibre_id: number;
  title: string;
  authors: string;
  series: string | null;
  tags: string | null;
  publisher: string | null;
  description: string | null;
  formats: string;
  has_epub: number;
  cover_path: string | null;
  server_url?: string;
  server_name?: string | null;
};

export type IndexJob = {
  id: number;
  status: "idle" | "running" | "done" | "error";
  message: string | null;
  books_indexed: number;
  started_at: string | null;
  finished_at: string | null;
};

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      name TEXT,
      username TEXT,
      password TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_status TEXT,
      last_error TEXT,
      last_indexed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL,
      calibre_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '',
      series TEXT,
      tags TEXT,
      publisher TEXT,
      description TEXT,
      formats TEXT NOT NULL DEFAULT '[]',
      has_epub INTEGER NOT NULL DEFAULT 0,
      cover_path TEXT,
      UNIQUE(server_id, library_id, calibre_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
      title,
      authors,
      series,
      tags,
      publisher,
      description,
      content='books',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
      INSERT INTO books_fts(rowid, title, authors, series, tags, publisher, description)
      VALUES (new.id, new.title, new.authors, new.series, new.tags, new.publisher, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, title, authors, series, tags, publisher, description)
      VALUES ('delete', old.id, old.title, old.authors, old.series, old.tags, old.publisher, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, title, authors, series, tags, publisher, description)
      VALUES ('delete', old.id, old.title, old.authors, old.series, old.tags, old.publisher, old.description);
      INSERT INTO books_fts(rowid, title, authors, series, tags, publisher, description)
      VALUES (new.id, new.title, new.authors, new.series, new.tags, new.publisher, new.description);
    END;

    CREATE TABLE IF NOT EXISTS index_jobs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      message TEXT,
      books_indexed INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT
    );

    INSERT OR IGNORE INTO index_jobs (id, status) VALUES (1, 'idle');
  `);

  migrateServersColumns(db);

  dbInstance = db;
  return db;
}

function migrateServersColumns(db: Database.Database): void {
  const cols = (
    db.prepare("PRAGMA table_info(servers)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!cols.includes("last_status")) {
    db.exec("ALTER TABLE servers ADD COLUMN last_status TEXT");
  }
  if (!cols.includes("last_error")) {
    db.exec("ALTER TABLE servers ADD COLUMN last_error TEXT");
  }
  if (!cols.includes("last_indexed_at")) {
    db.exec("ALTER TABLE servers ADD COLUMN last_indexed_at TEXT");
  }

  // Infer OK for servers that already have EPUB rows but no status yet.
  db.exec(`
    UPDATE servers
    SET last_status = 'ok'
    WHERE last_status IS NULL
      AND id IN (
        SELECT DISTINCT server_id FROM books WHERE has_epub = 1
      )
  `);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function listServers(): Server[] {
  return getDb().prepare("SELECT * FROM servers ORDER BY id").all() as Server[];
}

export function listServersWithStats(): ServerStats[] {
  return getDb()
    .prepare(
      `SELECT
         s.id, s.url, s.name, s.username, s.created_at,
         s.last_status, s.last_error, s.last_indexed_at,
         COALESCE(COUNT(b.id), 0) AS book_count
       FROM servers s
       LEFT JOIN books b ON b.server_id = s.id AND b.has_epub = 1
       GROUP BY s.id
       ORDER BY book_count DESC, s.id`
    )
    .all() as ServerStats[];
}

export function setServerIndexStatus(
  serverId: number,
  update: {
    last_status: ServerStatus;
    last_error?: string | null;
    last_indexed_at?: string | null;
  }
): void {
  getDb()
    .prepare(
      `UPDATE servers SET
         last_status = ?,
         last_error = ?,
         last_indexed_at = COALESCE(?, last_indexed_at)
       WHERE id = ?`
    )
    .run(
      update.last_status,
      update.last_error === undefined ? null : update.last_error,
      update.last_indexed_at === undefined ? null : update.last_indexed_at,
      serverId
    );
}

export function addServer(input: {
  url: string;
  name?: string;
  username?: string;
  password?: string;
}): Server {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error("URL is required");

  const result = getDb()
    .prepare(
      `INSERT INTO servers (url, name, username, password)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      url,
      input.name?.trim() || null,
      input.username?.trim() || null,
      input.password || null
    );

  return getDb()
    .prepare("SELECT * FROM servers WHERE id = ?")
    .get(result.lastInsertRowid) as Server;
}

export function deleteServer(id: number): void {
  getDb().prepare("DELETE FROM servers WHERE id = ?").run(id);
}

export function getServer(id: number): Server | undefined {
  return getDb().prepare("SELECT * FROM servers WHERE id = ?").get(id) as
    | Server
    | undefined;
}

export function getBook(id: number): Book | undefined {
  return getDb()
    .prepare(
      `SELECT b.*, s.url AS server_url, s.name AS server_name,
              s.username AS server_username, s.password AS server_password
       FROM books b
       JOIN servers s ON s.id = b.server_id
       WHERE b.id = ?`
    )
    .get(id) as Book | undefined;
}

export function clearBooksForServer(serverId: number): void {
  getDb().prepare("DELETE FROM books WHERE server_id = ?").run(serverId);
}

export function upsertBook(book: {
  server_id: number;
  library_id: string;
  calibre_id: number;
  title: string;
  authors: string;
  series: string | null;
  tags: string | null;
  publisher: string | null;
  description: string | null;
  formats: string;
  has_epub: number;
  cover_path: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO books (
        server_id, library_id, calibre_id, title, authors, series, tags,
        publisher, description, formats, has_epub, cover_path
      ) VALUES (
        @server_id, @library_id, @calibre_id, @title, @authors, @series, @tags,
        @publisher, @description, @formats, @has_epub, @cover_path
      )
      ON CONFLICT(server_id, library_id, calibre_id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        series = excluded.series,
        tags = excluded.tags,
        publisher = excluded.publisher,
        description = excluded.description,
        formats = excluded.formats,
        has_epub = excluded.has_epub,
        cover_path = excluded.cover_path`
    )
    .run(book);
}

function escapeFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return tokens.join(" ");
}

export function searchBooks(query: string, limit = 50): Book[] {
  const db = getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    return db
      .prepare(
        `SELECT b.*, s.url AS server_url, s.name AS server_name
         FROM books b
         JOIN servers s ON s.id = b.server_id
         WHERE b.has_epub = 1
         ORDER BY b.title COLLATE NOCASE
         LIMIT ?`
      )
      .all(limit) as Book[];
  }

  const fts = escapeFtsQuery(trimmed);
  if (!fts) return [];

  return db
    .prepare(
      `SELECT b.*, s.url AS server_url, s.name AS server_name
       FROM books_fts f
       JOIN books b ON b.id = f.rowid
       JOIN servers s ON s.id = b.server_id
       WHERE books_fts MATCH ? AND b.has_epub = 1
       ORDER BY rank
       LIMIT ?`
    )
    .all(fts, limit) as Book[];
}

export function getBookCount(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM books WHERE has_epub = 1")
      .get() as { c: number }
  ).c;
}

export function getIndexJob(): IndexJob {
  return getDb()
    .prepare("SELECT * FROM index_jobs WHERE id = 1")
    .get() as IndexJob;
}

export function setIndexJob(update: Partial<IndexJob>): void {
  const current = getIndexJob();
  getDb()
    .prepare(
      `UPDATE index_jobs SET
        status = ?,
        message = ?,
        books_indexed = ?,
        started_at = ?,
        finished_at = ?
       WHERE id = 1`
    )
    .run(
      update.status ?? current.status,
      update.message === undefined ? current.message : update.message,
      update.books_indexed ?? current.books_indexed,
      update.started_at === undefined ? current.started_at : update.started_at,
      update.finished_at === undefined ? current.finished_at : update.finished_at
    );
}

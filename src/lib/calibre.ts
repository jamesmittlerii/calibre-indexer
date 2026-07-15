import type { Server } from "./db";

export type CalibreBookMeta = {
  title?: string;
  authors?: string[];
  series?: string | null;
  tags?: string[];
  publisher?: string | null;
  comments?: string | null;
  formats?: string[];
  cover?: string;
  thumbnail?: string;
  format_metadata?: Record<string, unknown>;
};

export type LibraryInfo = {
  library_map: Record<string, string>;
  default_library: string;
};

function authHeader(server: Server): HeadersInit | undefined {
  if (!server.username) return undefined;
  const token = Buffer.from(
    `${server.username}:${server.password ?? ""}`
  ).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function joinUrl(base: string, ...parts: string[]): string {
  const root = base.replace(/\/+$/, "");
  const path = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `${root}/${path}`;
}

async function calibreFetch(
  server: Server,
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const url = joinUrl(server.url, path);
  const headers = new Headers(init?.headers);
  const auth = authHeader(server);
  if (auth) {
    for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  }

  const { timeoutMs = 20_000, signal, ...rest } = init ?? {};

  const res = await fetch(url, {
    ...rest,
    headers,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(
      `Calibre request failed (${res.status}) for ${url}: ${res.statusText}`
    );
  }
  return res;
}

export async function fetchLibraryInfo(server: Server): Promise<LibraryInfo> {
  const res = await calibreFetch(server, "/ajax/library-info");
  return (await res.json()) as LibraryInfo;
}

export async function fetchBookIdsPage(
  server: Server,
  libraryId: string,
  offset: number,
  num = 200
): Promise<{ book_ids: number[]; total_num: number }> {
  const qs = new URLSearchParams({
    query: "",
    num: String(num),
    offset: String(offset),
    sort: "title",
    sort_order: "asc",
  });
  const res = await calibreFetch(
    server,
    `/ajax/search/${encodeURIComponent(libraryId)}?${qs}`
  );
  return (await res.json()) as { book_ids: number[]; total_num: number };
}

export async function fetchBooksMeta(
  server: Server,
  libraryId: string,
  ids: number[]
): Promise<Record<string, CalibreBookMeta | null>> {
  if (ids.length === 0) return {};
  const qs = new URLSearchParams({
    ids: ids.join(","),
    category_urls: "false",
  });
  const res = await calibreFetch(
    server,
    `/ajax/books/${encodeURIComponent(libraryId)}?${qs}`
  );
  return (await res.json()) as Record<string, CalibreBookMeta | null>;
}

export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bookHasEpub(meta: CalibreBookMeta): boolean {
  const formats = (meta.formats ?? []).map((f) => f.toLowerCase());
  if (formats.includes("epub")) return true;
  const keys = Object.keys(meta.format_metadata ?? {}).map((k) =>
    k.toLowerCase()
  );
  return keys.includes("epub");
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // slow remote Calibre servers

export async function downloadEpub(
  server: Server,
  libraryId: string,
  calibreId: number
): Promise<{
  body: ReadableStream<Uint8Array>;
  filename: string;
  contentType: string;
  contentLength: string | null;
}> {
  const res = await calibreFetch(
    server,
    `/get/EPUB/${calibreId}/${encodeURIComponent(libraryId)}`,
    { timeoutMs: DOWNLOAD_TIMEOUT_MS }
  );
  if (!res.body) {
    throw new Error("Calibre returned an empty EPUB body");
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
  const filename = match
    ? decodeURIComponent(match[1].replace(/"/g, ""))
    : `book-${calibreId}.epub`;
  const contentType = res.headers.get("content-type") ?? "application/epub+zip";
  return {
    body: res.body,
    filename,
    contentType,
    contentLength: res.headers.get("content-length"),
  };
}

export function absoluteCoverUrl(
  serverUrl: string,
  coverPath: string | null | undefined
): string | null {
  if (!coverPath) return null;
  if (/^https?:\/\//i.test(coverPath)) return coverPath;
  const root = serverUrl.replace(/\/+$/, "");
  return coverPath.startsWith("/") ? `${root}${coverPath}` : `${root}/${coverPath}`;
}

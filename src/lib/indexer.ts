import {
  bookHasEpub,
  fetchBookIdsPage,
  fetchBooksMeta,
  fetchLibraryInfo,
  stripHtml,
  type CalibreBookMeta,
} from "./calibre";
import {
  clearBooksForServer,
  getIndexJob,
  getServer,
  listServers,
  setIndexJob,
  setServerIndexStatus,
  upsertBook,
  type Server,
} from "./db";

const PAGE_SIZE = 200;
const META_CHUNK = 50;
const DEFAULT_CONCURRENCY = 8;

let cancelController: AbortController | null = null;

function indexConcurrency(): number {
  const raw = Number(process.env.INDEX_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_CONCURRENCY;
  return Math.min(Math.floor(raw), 32);
}

/** Request cancel of the in-flight index job. Returns false if nothing was running. */
export function cancelIndex(): boolean {
  const job = getIndexJob();
  if (job.status !== "running" && !cancelController) return false;

  cancelController?.abort();
  setIndexJob({
    status: "cancelled",
    message: `Cancelled — ${job.books_indexed.toLocaleString()} books indexed so far`,
    books_indexed: job.books_indexed,
    finished_at: new Date().toISOString(),
  });
  return true;
}

function isCancelled(): boolean {
  return cancelController?.signal.aborted === true;
}

/** Run async work over items with a fixed concurrency pool. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (true) {
      if (isCancelled()) return;
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    run()
  );
  await Promise.all(pool);
  return results;
}

function authorsToString(authors: string[] | undefined): string {
  return (authors ?? []).filter(Boolean).join(", ");
}

function tagsToString(tags: string[] | undefined): string | null {
  const list = (tags ?? []).filter(Boolean);
  return list.length ? list.join(", ") : null;
}

function formatsJson(meta: CalibreBookMeta): string {
  const fromList = meta.formats ?? [];
  const fromMeta = Object.keys(meta.format_metadata ?? {});
  const all = Array.from(
    new Set([...fromList, ...fromMeta].map((f) => f.toLowerCase()))
  );
  return JSON.stringify(all);
}

class ServerRemovedError extends Error {
  constructor(serverId: number) {
    super(`Server ${serverId} was removed during indexing`);
    this.name = "ServerRemovedError";
  }
}

class IndexCancelledError extends Error {
  constructor() {
    super("Index cancelled");
    this.name = "IndexCancelledError";
  }
}

function ensureNotCancelled(): void {
  if (isCancelled()) throw new IndexCancelledError();
}

function ensureServerStillPresent(serverId: number): void {
  ensureNotCancelled();
  if (!getServer(serverId)) {
    throw new ServerRemovedError(serverId);
  }
}

function indexSignal(): AbortSignal | undefined {
  return cancelController?.signal;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

async function indexServer(server: Server, onProgress: (n: number) => void) {
  const signal = indexSignal();
  ensureServerStillPresent(server.id);
  const info = await fetchLibraryInfo(server, signal);
  ensureServerStillPresent(server.id);
  const libraryIds = Object.keys(info.library_map);
  if (libraryIds.length === 0) {
    libraryIds.push(info.default_library || "Calibre_Library");
  }

  clearBooksForServer(server.id);
  let indexed = 0;

  for (const libraryId of libraryIds) {
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      ensureServerStillPresent(server.id);
      const page = await fetchBookIdsPage(
        server,
        libraryId,
        offset,
        PAGE_SIZE,
        signal
      );
      total = page.total_num;
      const ids = page.book_ids ?? [];
      if (ids.length === 0) break;

      for (let i = 0; i < ids.length; i += META_CHUNK) {
        ensureServerStillPresent(server.id);
        const chunk = ids.slice(i, i + META_CHUNK);
        const metas = await fetchBooksMeta(server, libraryId, chunk, signal);

        for (const id of chunk) {
          ensureNotCancelled();
          const meta = metas[String(id)];
          if (!meta || !bookHasEpub(meta)) continue;

          upsertBook({
            server_id: server.id,
            library_id: libraryId,
            calibre_id: id,
            title: meta.title?.trim() || `Untitled #${id}`,
            authors: authorsToString(meta.authors),
            series: meta.series ?? null,
            tags: tagsToString(meta.tags),
            publisher: meta.publisher ?? null,
            description: stripHtml(meta.comments),
            formats: formatsJson(meta),
            has_epub: 1,
            cover_path: meta.cover ?? meta.thumbnail ?? null,
          });
          indexed += 1;
          onProgress(indexed);
        }
      }

      offset += ids.length;
    }
  }

  return indexed;
}

async function indexOneServerTracked(
  server: Server,
  onProgress: (n: number) => void
): Promise<number> {
  const label = server.name || server.url;
  if (!getServer(server.id)) {
    throw new ServerRemovedError(server.id);
  }
  ensureNotCancelled();
  setServerIndexStatus(server.id, {
    last_status: "indexing",
    last_error: null,
  });
  try {
    const count = await indexServer(server, onProgress);
    if (!getServer(server.id)) {
      throw new ServerRemovedError(server.id);
    }
    ensureNotCancelled();
    setServerIndexStatus(server.id, {
      last_status: "ok",
      last_error: null,
      last_indexed_at: new Date().toISOString(),
    });
    return count;
  } catch (err) {
    if (err instanceof IndexCancelledError || isCancelled() || isAbortError(err)) {
      if (getServer(server.id)) {
        setServerIndexStatus(server.id, {
          last_status: "pending",
          last_error: null,
        });
      }
      throw err instanceof IndexCancelledError
        ? err
        : new IndexCancelledError();
    }
    if (err instanceof ServerRemovedError || !getServer(server.id)) {
      console.warn(`Stopped indexing ${label}: server removed`);
      throw err instanceof ServerRemovedError
        ? err
        : new ServerRemovedError(server.id);
    }
    const reason = err instanceof Error ? err.message : "unknown error";
    console.warn(`Skipping ${label}: ${reason}`);
    setServerIndexStatus(server.id, {
      last_status: "error",
      last_error: reason,
      last_indexed_at: new Date().toISOString(),
    });
    throw err;
  }
}

function beginIndexRun(): AbortController {
  if (cancelController) {
    throw new Error("An index job is already running");
  }
  const controller = new AbortController();
  cancelController = controller;
  return controller;
}

function endIndexRun(controller: AbortController): void {
  if (cancelController === controller) {
    cancelController = null;
  }
}

function markCancelled(booksIndexed: number): void {
  const job = getIndexJob();
  if (job.status === "cancelled") {
    setIndexJob({ books_indexed: booksIndexed });
    return;
  }
  setIndexJob({
    status: "cancelled",
    message: `Cancelled — ${booksIndexed.toLocaleString()} books indexed so far`,
    books_indexed: booksIndexed,
    finished_at: new Date().toISOString(),
  });
}

export async function runIndexForServers(
  servers: Server[]
): Promise<{ booksIndexed: number }> {
  const job = getIndexJob();
  if (job.status === "running") {
    throw new Error("An index job is already running");
  }

  if (servers.length === 0) {
    throw new Error("No servers to index");
  }

  if (servers.length === 1) {
    return runServerIndex(servers[0].id);
  }

  const concurrency = indexConcurrency();
  const controller = beginIndexRun();

  setIndexJob({
    status: "running",
    message: `Indexing ${servers.length} server(s) (${concurrency} at a time)…`,
    books_indexed: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
  });

  let total = 0;
  let failed = 0;
  let completed = 0;
  let active = 0;
  let lastFlush = 0;

  const flushProgress = (label: string, force = false) => {
    if (isCancelled()) return;
    const now = Date.now();
    if (!force && now - lastFlush < 400) return;
    lastFlush = now;
    setIndexJob({
      books_indexed: total,
      message: `Indexing ${active} live · ${completed}/${servers.length} done · ${total} books${
        label ? ` · ${label}` : ""
      }`,
    });
  };

  const bumpProgress = (serverDelta: number, label: string) => {
    total += serverDelta;
    flushProgress(label);
  };

  try {
    await mapPool(servers, concurrency, async (server) => {
      if (isCancelled()) return null;
      if (!getServer(server.id)) {
        completed += 1;
        return null;
      }

      const label = server.name || server.url;
      let lastReported = 0;
      active += 1;
      flushProgress(label, true);

      try {
        const count = await indexOneServerTracked(server, (n) => {
          ensureNotCancelled();
          const delta = n - lastReported;
          lastReported = n;
          if (delta > 0) bumpProgress(delta, label);
        });
        const remainder = count - lastReported;
        if (remainder > 0) bumpProgress(remainder, label);
        completed += 1;
        flushProgress(label, true);
      } catch (err) {
        completed += 1;
        if (err instanceof IndexCancelledError || isAbortError(err)) {
          // leave completed count; outer handler finishes the job
        } else if (err instanceof ServerRemovedError) {
          setIndexJob({
            message: `Removed ${label} during index. ${completed}/${servers.length} done · ${total} books`,
            books_indexed: total,
          });
        } else {
          failed += 1;
          setIndexJob({
            message: `Skipped ${label} (${failed} failed). ${completed}/${servers.length} done · ${total} books`,
            books_indexed: total,
          });
        }
      } finally {
        active -= 1;
      }

      return null;
    });

    if (isCancelled()) {
      markCancelled(total);
      return { booksIndexed: total };
    }

    setIndexJob({
      status: "done",
      message:
        failed > 0
          ? `Indexed ${total} books from ${servers.length - failed}/${servers.length} server(s) (${failed} skipped, concurrency ${concurrency})`
          : `Indexed ${total} books from ${servers.length} server(s) (concurrency ${concurrency})`,
      books_indexed: total,
      finished_at: new Date().toISOString(),
    });
    return { booksIndexed: total };
  } catch (err) {
    if (err instanceof IndexCancelledError || isCancelled() || isAbortError(err)) {
      markCancelled(total);
      return { booksIndexed: total };
    }
    const message = err instanceof Error ? err.message : "Index failed";
    setIndexJob({
      status: "error",
      message,
      books_indexed: total,
      finished_at: new Date().toISOString(),
    });
    throw err;
  } finally {
    endIndexRun(controller);
  }
}

export async function runFullIndex(): Promise<{ booksIndexed: number }> {
  const servers = listServers();
  if (servers.length === 0) {
    throw new Error("Add at least one Calibre server URL first");
  }
  return runIndexForServers(servers);
}

export async function runServerIndex(
  serverId: number
): Promise<{ booksIndexed: number }> {
  const job = getIndexJob();
  if (job.status === "running") {
    throw new Error("An index job is already running");
  }

  const server = getServer(serverId);
  if (!server) {
    throw new Error("Server not found");
  }

  const label = server.name || server.url;
  const controller = beginIndexRun();

  setIndexJob({
    status: "running",
    message: `Indexing ${label}…`,
    books_indexed: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
  });

  try {
    const count = await indexOneServerTracked(server, (n) => {
      ensureNotCancelled();
      if (!getServer(serverId)) {
        throw new ServerRemovedError(serverId);
      }
      setIndexJob({
        books_indexed: n,
        message: `Indexing ${label}… (${n} books)`,
      });
    });
    if (isCancelled()) {
      markCancelled(count);
      return { booksIndexed: count };
    }
    if (!getServer(serverId)) {
      setIndexJob({
        status: "done",
        message: `Stopped: ${label} was removed`,
        books_indexed: count,
        finished_at: new Date().toISOString(),
      });
      return { booksIndexed: count };
    }
    setIndexJob({
      status: "done",
      message: `Indexed ${count} books from ${label}`,
      books_indexed: count,
      finished_at: new Date().toISOString(),
    });
    return { booksIndexed: count };
  } catch (err) {
    if (err instanceof IndexCancelledError || isCancelled() || isAbortError(err)) {
      markCancelled(getIndexJob().books_indexed);
      return { booksIndexed: getIndexJob().books_indexed };
    }
    if (err instanceof ServerRemovedError || !getServer(serverId)) {
      setIndexJob({
        status: "done",
        message: `Stopped: ${label} was removed`,
        finished_at: new Date().toISOString(),
      });
      return { booksIndexed: 0 };
    }
    const message = err instanceof Error ? err.message : "Index failed";
    setIndexJob({
      status: "error",
      message: `${label}: ${message}`,
      books_indexed: 0,
      finished_at: new Date().toISOString(),
    });
    throw err;
  } finally {
    endIndexRun(controller);
  }
}

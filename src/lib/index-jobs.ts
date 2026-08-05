import {
  getIndexJob,
  getServer,
  listServers,
  listUnindexedServers,
  setIndexJob,
  setServerIndexStatus,
  type Server,
} from "./db";
import {
  cancelIndex,
  runFullIndex,
  runIndexForServers,
  runServerIndex,
} from "./indexer";

let activeIndex: Promise<unknown> | null = null;
const queuedServerIds: number[] = [];
let startupScheduled = false;

function clearStuckIndexingServers(): void {
  for (const server of listServers()) {
    if (server.last_status !== "indexing") continue;
    setServerIndexStatus(server.id, {
      last_status: server.last_indexed_at ? "ok" : "pending",
      last_error: null,
    });
  }
}

/** Clear jobs left "running" after a process crash/restart. */
export function reclaimOrphanedJob(): void {
  if (activeIndex !== null) return;
  const job = getIndexJob();
  if (job.status === "running") {
    const books = job.books_indexed ?? 0;
    setIndexJob({
      status: books > 0 ? "done" : "error",
      message: books > 0
        ? `Interrupted after ${books.toLocaleString()} books — ${job.message ?? "indexing stopped"}`
        : job.message
          ? `Interrupted: ${job.message}`
          : "Interrupted: server restarted during indexing",
      finished_at: new Date().toISOString(),
    });
  } else if (
    job.status === "error" &&
    (job.message?.startsWith("Indexing ") || job.message?.includes("… ("))
  ) {
    // Stale progress text left on an error row after a crash.
    const books = job.books_indexed ?? 0;
    setIndexJob({
      status: books > 0 ? "done" : "error",
      message: books > 0
        ? `Recovered — ${books.toLocaleString()} books were indexed before the job stopped`
        : job.message,
      finished_at: job.finished_at ?? new Date().toISOString(),
    });
  }
  // Servers can stay marked "indexing" if the process died mid-job.
  clearStuckIndexingServers();
}

export function isIndexBusy(): boolean {
  reclaimOrphanedJob();
  return getIndexJob().status === "running" || activeIndex !== null;
}

function startWork(work: () => Promise<unknown>): void {
  activeIndex = work()
    .catch(() => undefined)
    .finally(() => {
      activeIndex = null;
      pumpQueue();
    });
}

function pumpQueue(): void {
  if (activeIndex !== null) return;
  reclaimOrphanedJob();
  if (getIndexJob().status === "running") return;

  if (queuedServerIds.length === 0) return;

  const ids = [...new Set(queuedServerIds.splice(0, queuedServerIds.length))];
  const servers = ids
    .map((id) => getServer(id))
    .filter((s): s is Server => Boolean(s));

  if (servers.length === 0) return;

  startWork(() =>
    servers.length === 1
      ? runServerIndex(servers[0].id)
      : runIndexForServers(servers)
  );
}

/** Queue one server for indexing (starts immediately if idle). */
export function enqueueServerIndex(serverId: number): void {
  if (!Number.isFinite(serverId) || serverId <= 0) return;
  if (!getServer(serverId)) return;
  if (!queuedServerIds.includes(serverId)) {
    queuedServerIds.push(serverId);
  }
  pumpQueue();
}

/** On process start: index any servers that have never been indexed. */
export function scheduleStartupUnindexed(): void {
  if (startupScheduled) return;
  startupScheduled = true;
  reclaimOrphanedJob();
  for (const server of listUnindexedServers()) {
    if (!queuedServerIds.includes(server.id)) {
      queuedServerIds.push(server.id);
    }
  }
  pumpQueue();
}

export function startFullIndex(): { ok: true } | { ok: false; error: string } {
  if (isIndexBusy()) {
    return { ok: false, error: "An index job is already running" };
  }
  if (listServers().length === 0) {
    return { ok: false, error: "Add at least one Calibre server URL first" };
  }
  // Manual full rebuild should not also drain a stale queue afterward for
  // servers already included — clear queue first, then run all.
  queuedServerIds.length = 0;
  startWork(() => runFullIndex());
  return { ok: true };
}

export function startServerIndex(
  serverId: number
): { ok: true } | { ok: false; error: string; status?: number } {
  if (isIndexBusy()) {
    // Queue behind the current job instead of failing.
    enqueueServerIndex(serverId);
    return { ok: true };
  }
  if (!Number.isFinite(serverId) || serverId <= 0 || !getServer(serverId)) {
    return { ok: false, error: "Server not found", status: 404 };
  }
  enqueueServerIndex(serverId);
  return { ok: true };
}

export function requestCancelIndex(): boolean {
  queuedServerIds.length = 0;
  return cancelIndex();
}

export function getActiveIndexState() {
  reclaimOrphanedJob();
  return {
    busy: isIndexBusy(),
    queued: queuedServerIds.length,
  };
}

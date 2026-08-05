import { NextResponse } from "next/server";
import { getBookCount, getIndexJob, getServer, listServers } from "@/lib/db";
import {
  getActiveIndexState,
  reclaimOrphanedJob,
  requestCancelIndex,
  scheduleStartupUnindexed,
  startFullIndex,
  startServerIndex,
} from "@/lib/index-jobs";

export const runtime = "nodejs";

scheduleStartupUnindexed();

export async function GET() {
  reclaimOrphanedJob();
  return NextResponse.json({
    job: getIndexJob(),
    bookCount: getBookCount(),
    ...getActiveIndexState(),
  });
}

export async function DELETE() {
  const cancelled = requestCancelIndex();
  if (!cancelled) {
    return NextResponse.json(
      {
        error: "No index job is running",
        job: getIndexJob(),
        bookCount: getBookCount(),
      },
      { status: 409 }
    );
  }
  return NextResponse.json({
    cancelled: true,
    job: getIndexJob(),
    bookCount: getBookCount(),
  });
}

export async function POST(request: Request) {
  let serverId: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      serverId?: number;
    };
    if (body.serverId != null) {
      serverId = Number(body.serverId);
    }
  } catch {
    serverId = undefined;
  }

  if (serverId != null) {
    const result = startServerIndex(serverId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, job: getIndexJob(), bookCount: getBookCount() },
        { status: result.status ?? 409 }
      );
    }
  } else {
    if (listServers().length === 0) {
      return NextResponse.json(
        {
          error: "Add at least one Calibre server URL first",
          job: getIndexJob(),
          bookCount: getBookCount(),
        },
        { status: 400 }
      );
    }
    // Rebuild-all still rejects when busy (don't silently queue a full rebuild).
    const result = startFullIndex();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, job: getIndexJob(), bookCount: getBookCount() },
        { status: 409 }
      );
    }
  }

  await new Promise((r) => setTimeout(r, 25));

  return NextResponse.json({
    started: true,
    job: getIndexJob(),
    bookCount: getBookCount(),
    server: serverId != null ? getServer(serverId) : undefined,
  });
}

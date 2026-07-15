import { NextResponse } from "next/server";
import { getBookCount, getIndexJob, getServer, listServers } from "@/lib/db";
import { runFullIndex, runServerIndex } from "@/lib/indexer";

export const runtime = "nodejs";

let activeIndex: Promise<unknown> | null = null;

function jobBusy() {
  return getIndexJob().status === "running" || activeIndex !== null;
}

export async function GET() {
  return NextResponse.json({
    job: getIndexJob(),
    bookCount: getBookCount(),
  });
}

export async function POST(request: Request) {
  if (jobBusy()) {
    return NextResponse.json(
      {
        error: "An index job is already running",
        job: getIndexJob(),
        bookCount: getBookCount(),
      },
      { status: 409 }
    );
  }

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
    if (!Number.isFinite(serverId) || serverId <= 0 || !getServer(serverId)) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }
    activeIndex = runServerIndex(serverId)
      .catch(() => undefined)
      .finally(() => {
        activeIndex = null;
      });
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
    activeIndex = runFullIndex()
      .catch(() => undefined)
      .finally(() => {
        activeIndex = null;
      });
  }

  await new Promise((r) => setTimeout(r, 25));

  return NextResponse.json({
    started: true,
    job: getIndexJob(),
    bookCount: getBookCount(),
  });
}

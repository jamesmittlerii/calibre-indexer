import { NextResponse } from "next/server";
import {
  addServer,
  deleteServer,
  listServersWithStats,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ servers: listServersWithStats() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      name?: string;
      username?: string;
      password?: string;
    };
    if (!body.url?.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const server = addServer({
      url: body.url,
      name: body.name,
      username: body.username,
      password: body.password,
    });
    const { password: _password, ...safe } = server;
    return NextResponse.json({ server: safe }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add server";
    const status = message.includes("UNIQUE") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  deleteServer(id);
  return NextResponse.json({ ok: true });
}

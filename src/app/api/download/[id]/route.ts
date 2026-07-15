import { NextResponse } from "next/server";
import { downloadEpub } from "@/lib/calibre";
import { getBook, getServer } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  const book = getBook(id);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  if (!book.has_epub) {
    return NextResponse.json(
      { error: "No EPUB available for this book" },
      { status: 404 }
    );
  }

  const server = getServer(book.server_id);
  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  try {
    const file = await downloadEpub(server, book.library_id, book.calibre_id);
    const headers: Record<string, string> = {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store",
    };
    if (file.contentLength) {
      headers["Content-Length"] = file.contentLength;
    }
    return new NextResponse(file.body, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

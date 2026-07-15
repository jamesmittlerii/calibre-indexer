import { NextResponse } from "next/server";
import { searchBooks } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 50) || 50, 100);
  const books = searchBooks(q, limit);
  return NextResponse.json({ books, query: q });
}

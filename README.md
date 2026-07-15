# Calibre Indexer

Index books from one or more [Calibre Content Server](https://manual.calibre-ebook.com/server.html) URLs into a local SQLite database with full-text search, then download matching EPUBs.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Go to **Servers** and add Calibre content server URLs (optional basic auth).
2. Click **Rebuild index** to crawl each server’s libraries into SQLite (`data/index.db`).
3. Search from the home page and use **Get EPUB** to download a match via the server.

## Notes

- Indexing uses Calibre’s ajax API (`/ajax/library-info`, `/ajax/search`, `/ajax/books`).
- Full rebuilds crawl servers concurrently (default **8** at a time). Override with `INDEX_CONCURRENCY=16`.
- EPUB files are streamed from `/get/EPUB/{id}/{library_id}` on the source server.
- Credentials are stored locally in SQLite for server-side fetch only.
# calibre-indexer

const net = require("net");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const URLS = `
http://100.37.13.21:9090
http://100.37.131.35:8020
http://102.182.200.164:80
http://104.131.175.196:8080
http://104.152.81.36:8090
http://107.134.17.245:8080
http://108.181.216.26:8080
http://108.212.105.113:8484
http://108.217.130.20:8888
http://108.236.22.113:8080
http://108.29.2.177:8080
http://108.31.110.78:9090
http://108.70.83.153:8080
http://109.7.245.5:8080
http://109.91.131.57:9000
http://113.155.77.103:8080
http://114.34.4.6:8080
http://115.68.27.183:8080
http://116.202.20.246:8080
http://117.250.144.92:8086
http://136.169.223.16:8080
http://136.39.10.87:8082
http://136.49.163.220:8080
http://136.61.53.171:8087
http://152.136.57.79:8080
http://152.230.141.217:84
http://153.205.88.110:8080
http://155.93.192.70:8080
http://162.157.63.152:6060
http://162.234.244.247:8282
http://164.92.65.234:8080
http://165.255.248.196:8080
http://172.117.169.60:9090
http://173.212.20.148:8080
http://174.164.100.212:8080
http://176.182.170.224:1975
http://184.57.85.199:8080
http://194.145.195.108:8080
http://196.188.40.145:8080
http://198.58.112.110:8080
http://2.13.148.164:8080
http://2.4.61.215:8080
http://200.234.229.26:8080
http://203.124.40.232:8080
http://204.111.163.115:8080
http://205.209.236.19:8080
http://207.49.143.83:9090
http://209.25.189.207:8080
http://212.123.135.121:8080
http://213.179.98.189:5005
http://216.197.170.30:8080
http://216.213.191.2:8080
http://216.62.28.67:8080
http://218.56.10.6:12121
http://24.127.216.116:8080
http://24.143.104.16:8080
http://24.177.32.160:8080
http://24.192.41.47:8080
http://24.197.253.122:8080
http://31.201.27.195:9999
http://45.27.32.193:9191
http://45.81.60.43:8080
http://46.98.6.3:7081
http://47.5.246.140:8080
http://5.81.220.191:8086
http://50.66.173.136:9090
http://59.126.93.3:8080
http://62.34.254.214:8076
http://65.90.11.61:8080
http://66.110.246.39:8980
http://66.183.122.10:8080
http://67.180.101.128:8080
http://68.168.177.126:8080
http://68.194.16.9:8010
http://68.6.180.51:8080
http://69.148.189.26:10008
http://69.218.221.117:8080
http://70.112.136.164:5000
http://70.163.131.98:8080
http://71.174.209.194:1700
http://71.191.55.170:5721
http://72.201.149.240:8080
http://72.49.108.142:8080
http://73.142.200.99:8080
http://73.158.2.172:8080
http://73.209.47.206:9090
http://73.21.188.12:1984
http://73.211.241.2:8000
http://74.101.221.254:8080
http://75.111.218.164:8080
http://75.143.53.208:8080
http://75.187.73.228:8787
http://75.67.196.75:8078
http://77.171.160.242:8086
http://79.243.178.50:8080
http://82.213.236.230:5555
http://82.66.213.89:18095
http://82.69.34.216:8080
http://82.84.84.104:8080
http://83.150.18.63:7081
http://83.151.201.92:82
http://84.66.237.173:8080
http://84.67.83.156:8080
http://85.214.203.180:8080
http://85.243.70.43:8888
http://86.49.71.88:8080
http://86.57.134.14:82
http://87.192.96.40:9090
http://90.78.147.63:9090
http://91.138.2.178:8080
http://92.152.96.140:8080
http://95.216.170.22:8080
http://96.236.206.188:9000
http://97.81.105.192:18080
http://97.83.100.5:8080
http://97.86.244.187:8080
http://98.223.85.9:8090
http://99.17.230.60:8081
http://99.17.40.185:80
http://99.189.172.101:8080
http://99.247.26.195:8086
http://99.249.130.93:8080
http://99.73.72.213:8080
`
  .trim()
  .split(/\r?\n/)
  .map((u) => u.trim())
  .filter(Boolean);

const TIMEOUT_MS = 2500;
const CONCURRENCY = 40;

function checkPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function main() {
  console.log(`Checking ${URLS.length} hosts (timeout ${TIMEOUT_MS}ms, concurrency ${CONCURRENCY})…`);

  const results = await mapPool(URLS, CONCURRENCY, async (url) => {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    const open = await checkPort(host, port, TIMEOUT_MS);
    return { url: url.replace(/\/+$/, ""), host, port, open };
  });

  const openOnes = results.filter((r) => r.open);
  const closedOnes = results.filter((r) => !r.open);

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "index.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      name TEXT,
      username TEXT,
      password TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

  const upsert = db.prepare(`
    INSERT INTO servers (url, name, username, password)
    VALUES (?, ?, NULL, NULL)
    ON CONFLICT(url) DO UPDATE SET
      name = COALESCE(excluded.name, servers.name)
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      upsert.run(row.url, `Calibre @ ${row.host}:${row.port}`);
    }
  });
  insertMany(openOnes);

  const listPath = path.join(dataDir, "seed-open-servers.txt");
  fs.writeFileSync(listPath, openOnes.map((r) => r.url).join("\n") + (openOnes.length ? "\n" : ""));

  const count = db.prepare("SELECT COUNT(*) AS c FROM servers").get().c;
  db.close();

  console.log(
    JSON.stringify(
      {
        totalChecked: results.length,
        open: openOnes.length,
        closed: closedOnes.length,
        serversInDb: count,
        openUrls: openOnes.map((r) => r.url),
        listFile: listPath,
        dbPath,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

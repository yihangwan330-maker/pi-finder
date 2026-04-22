import { createReadStream, existsSync, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname);
const dataRoot = join(root, "data");
const port = Number(process.env.PORT || 8000);

const builtinConstants = {
  pi: { key: "pi", label: "π", fullName: "圆周率 π", availableDigits: 0, mode: "missing" },
  e: { key: "e", label: "e", fullName: "自然常数 e", availableDigits: 0, mode: "missing" },
  sqrt2: { key: "sqrt2", label: "√2", fullName: "√2", availableDigits: 0, mode: "missing" },
  phi: { key: "phi", label: "φ", fullName: "黄金比例 φ", availableDigits: 0, mode: "missing" }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function readManifest(key) {
  const manifestPath = join(dataRoot, key, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  return {
    key,
    label: manifest.label || builtinConstants[key]?.label || key,
    fullName: manifest.fullName || builtinConstants[key]?.fullName || key,
    availableDigits: Number(manifest.availableDigits || 0),
    chunkSize: Number(manifest.chunkSize || 1000000),
    chunks: manifest.chunks || [],
    mode: "dataset"
  };
}

async function getConstantInfo(key) {
  return (await readManifest(key)) || builtinConstants[key] || null;
}

async function listConstants() {
  const keys = Object.keys(builtinConstants);
  return Promise.all(keys.map((key) => getConstantInfo(key)));
}

function makeContext(digits, index, queryLength) {
  const radius = 34;
  const start = Math.max(0, index - radius);
  const end = Math.min(digits.length, index + queryLength + radius);
  return {
    before: digits.slice(start, index),
    match: digits.slice(index, index + queryLength),
    after: digits.slice(index + queryLength, end),
    hasBefore: start > 0,
    hasAfter: end < digits.length
  };
}

function readChunk(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    const stream = createReadStream(path, { encoding: "utf8" });
    stream.on("data", (chunk) => {
      data += chunk.replace(/\D/g, "");
    });
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(data));
  });
}

async function searchDataset(info, query, limit) {
  const startedAt = performance.now();
  const maxDigits = Math.min(limit, info.availableDigits);
  const overlapLength = Math.max(0, query.length - 1);
  let overlap = "";
  let searched = 0;

  for (const chunkName of info.chunks) {
    if (searched >= maxDigits) break;

    const chunkPath = join(dataRoot, info.key, chunkName);
    const remaining = maxDigits - searched;
    const chunk = (await readChunk(chunkPath)).slice(0, remaining);
    const searchable = overlap + chunk;
    const index = searchable.indexOf(query);

    if (index !== -1) {
      const absoluteZeroIndex = searched - overlap.length + index;
      return {
        mode: "dataset",
        searchedDigits: Math.min(maxDigits, searched + chunk.length),
        elapsedMs: Math.round(performance.now() - startedAt),
        found: true,
        start: absoluteZeroIndex + 1,
        end: absoluteZeroIndex + query.length,
        context: makeContext(searchable, index, query.length)
      };
    }

    searched += chunk.length;
    overlap = searchable.slice(-overlapLength);
  }

  return {
    mode: "dataset",
    searchedDigits: searched,
    elapsedMs: Math.round(performance.now() - startedAt),
    found: false,
    start: null,
    end: null,
    context: null
  };
}

function cleanQuery(value) {
  return String(value || "").replace(/\D/g, "");
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/constants") {
    sendJson(response, 200, { constants: await listConstants() });
    return;
  }

  if (url.pathname === "/api/search") {
    const key = url.searchParams.get("constant") || "pi";
    const query = cleanQuery(url.searchParams.get("query"));
    const limit = Math.min(Number(url.searchParams.get("limit") || 1000000), 100000000);
    const info = await getConstantInfo(key);

    if (!info) {
      sendJson(response, 404, { error: "Unknown constant" });
      return;
    }

    if (!query) {
      sendJson(response, 400, { error: "Query must contain digits" });
      return;
    }

    if (info.mode !== "dataset") {
      sendJson(response, 409, {
        error: "Dataset is not installed for this constant",
        constant: info
      });
      return;
    }

    const result = await searchDataset(info, query, limit);

    sendJson(response, 200, { constant: info, query, limit, ...result });
    return;
  }

  sendJson(response, 404, { error: "Unknown API route" });
}

async function serveStatic(request, response, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = normalize(join(root, pathname));

  if (!filePath.startsWith(root)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Number Trace running at http://localhost:${port}`);
});

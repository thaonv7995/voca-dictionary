import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(process.env.APP_DIST || path.join(rootDir, "dist"));
const dataDir = path.resolve(process.env.VOCA_DATA || rootDir);
const port = Number(process.env.PORT || 80);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
]);

function sendError(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

function resolveInside(baseDir, requestPath) {
  const resolved = path.resolve(baseDir, `.${requestPath}`);
  if (resolved !== baseDir && !resolved.startsWith(`${baseDir}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serveFile(request, response, filePath, cacheControl) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    sendError(response, 404, "Not found");
    return;
  }

  if (!fileStat.isFile()) {
    sendError(response, 404, "Not found");
    return;
  }

  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Cache-Control": cacheControl,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).on("error", () => {
    if (!response.headersSent) {
      sendError(response, 500, "Cannot read file");
    } else {
      response.destroy();
    }
  }).pipe(response);
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, 405, "Method not allowed");
    return;
  }

  if (pathname === "/cards.json") {
    await serveFile(request, response, path.join(dataDir, "cards.json"), "no-store");
    return;
  }

  if (pathname.startsWith("/cards/")) {
    const filePath = resolveInside(path.join(dataDir, "cards"), pathname.slice("/cards".length));
    if (!filePath) {
      sendError(response, 403, "Forbidden");
      return;
    }
    await serveFile(request, response, filePath, "no-store");
    return;
  }

  if (pathname.startsWith("/audio/")) {
    const filePath = resolveInside(path.join(dataDir, "audio"), pathname.slice("/audio".length));
    if (!filePath) {
      sendError(response, 403, "Forbidden");
      return;
    }
    await serveFile(request, response, filePath, "public, max-age=31536000, immutable");
    return;
  }

  const staticPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolveInside(distDir, staticPath);
  if (filePath && await fileExists(filePath)) {
    const isEntryHtml = staticPath === "/index.html";
    await serveFile(
      request,
      response,
      filePath,
      isEntryHtml ? "no-cache" : "public, max-age=31536000, immutable",
    );
    return;
  }

  await serveFile(request, response, path.join(distDir, "index.html"), "no-cache");
}

createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    sendError(response, 500, "Internal server error");
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`voca-dictionary listening on ${port}`);
});

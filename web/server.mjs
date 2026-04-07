import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const host = process.env.HOST_NAME || "0.0.0.0";
const port = Number(process.env.PORT || "43126");
const allowlistFile =
  process.env.IP_ALLOWLIST_FILE || "/home/ben/server/vibecode/ip_allowlist.json";
const trustForwardedFor = process.env.TRUST_X_FORWARDED_FOR === "true";
const loopbackAllowlist = new Set(["127.0.0.1", "::1"]);

let cachedAllowlistMtimeMs = -1;
let cachedAllowlist = { exact: new Set(loopbackAllowlist), cidrs: [] };

function normalizeIp(value) {
  if (!value) return null;

  let candidate = value.trim();
  if (!candidate) return null;

  if (candidate.includes(",")) {
    candidate = candidate.split(",")[0].trim();
  }

  if (candidate.startsWith("::ffff:")) {
    candidate = candidate.slice(7);
  }

  return candidate;
}

function ipv4ToInt(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }

  return ((((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function compileIpv4Cidr(value) {
  const [rawIp, rawPrefix] = value.split("/");
  const baseIp = normalizeIp(rawIp);
  const prefix = Number(rawPrefix);
  if (!baseIp || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const ipInt = ipv4ToInt(baseIp);
  if (ipInt === null) {
    return null;
  }

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return { family: 4, network: ipInt & mask, mask };
}

function isIpAllowed(clientIp, allowlist) {
  if (!clientIp) return false;
  if (allowlist.exact.has(clientIp)) return true;

  const family = net.isIP(clientIp);
  if (family !== 4) return false;

  const ipInt = ipv4ToInt(clientIp);
  if (ipInt === null) return false;

  return allowlist.cidrs.some((entry) => entry.family === 4 && (ipInt & entry.mask) === entry.network);
}

function buildAllowlist(exactEntries, cidrEntries, includeLoopback) {
  const exact = new Set(includeLoopback ? loopbackAllowlist : []);
  for (const entry of exactEntries) {
    const normalized = normalizeIp(entry);
    if (normalized) {
      exact.add(normalized);
    }
  }

  const cidrs = [];
  for (const entry of cidrEntries) {
    const compiled = compileIpv4Cidr(String(entry).trim());
    if (compiled) {
      cidrs.push(compiled);
    }
  }

  return { exact, cidrs };
}

function loadJsonAllowlist(content) {
  const parsed = JSON.parse(content);
  const defaults = parsed?.defaults ?? {};
  const includeLoopback = defaults.allow_loopback !== false;
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const exactEntries = [];
  const cidrEntries = [];

  for (const entry of entries) {
    if (!entry || entry.enabled === false) continue;
    if (typeof entry.ip === "string") exactEntries.push(entry.ip);
    if (typeof entry.cidr === "string") cidrEntries.push(entry.cidr);
  }

  return buildAllowlist(exactEntries, cidrEntries, includeLoopback);
}

function loadLegacyTextAllowlist(content) {
  const ips = content.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return buildAllowlist(ips, [], true);
}

function loadAllowlist() {
  try {
    const stat = fs.statSync(allowlistFile);
    if (stat.mtimeMs === cachedAllowlistMtimeMs) {
      return cachedAllowlist;
    }

    const content = fs.readFileSync(allowlistFile, "utf8");
    cachedAllowlist = allowlistFile.endsWith(".json")
      ? loadJsonAllowlist(content)
      : loadLegacyTextAllowlist(content);
    cachedAllowlistMtimeMs = stat.mtimeMs;
    return cachedAllowlist;
  } catch (error) {
    console.error(`[allowlist] failed to load ${allowlistFile}:`, error);
    cachedAllowlist = { exact: new Set(loopbackAllowlist), cidrs: [] };
    cachedAllowlistMtimeMs = -1;
    return cachedAllowlist;
  }
}

function extractClientIp(req) {
  if (trustForwardedFor) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return normalizeIp(forwarded);
    }
  }

  return normalizeIp(req.socket.remoteAddress);
}

const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Bad Request");
        return;
      }

      const clientIp = extractClientIp(req);

      if (req.url === "/__health") {
        if (!clientIp || !loopbackAllowlist.has(clientIp)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, port, host }));
        return;
      }

      const allowlist = loadAllowlist();

      if (!isIpAllowed(clientIp, allowlist)) {
        console.warn(
          `[allowlist] blocked request ip=${clientIp ?? "unknown"} method=${req.method ?? "GET"} url=${req.url}`,
        );
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      handle(req, res);
    });

    server.listen(port, host, () => {
      console.log(`> Custom Next server ready on http://${host}:${port}`);
      console.log(`> Allowlist file: ${path.resolve(allowlistFile)}`);
      console.log(`> trust_x_forwarded_for=${trustForwardedFor}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start custom Next server:", error);
    process.exit(1);
  });

#!/usr/bin/env node

"use strict";

const http = require("node:http");

const { host, port } = parseArgs(process.argv.slice(2));
const debugPayload = {
  ok: false,
  live: true,
  debugSessionId: "host-smoke-debug",
  source: "1/0",
  returnKind: "inspect",
  elapsedMs: 1,
  problem: {
    name: "ZeroDivide",
    message: "division by zero",
    number: 2026,
    contextOop: "7001",
    exceptionOop: "7002",
    frames: [
      {
        index: 0,
        selector: "UndefinedObject>>hostSmoke",
        printString: "UndefinedObject>>hostSmoke",
        source: "1/0",
        sourceOffset: 2,
        receiverOop: "20",
        receiverClass: "UndefinedObject",
        variables: [{ name: "divisor", value: "0", className: "SmallInteger" }],
      },
    ],
  },
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "GET" && url.pathname === "/api/config") {
    send(response, { ok: true, roots: ["UserGlobals"], fake: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    send(response, { stone: "host-smoke", sessionId: "fake-session", inTransaction: false, needsCommit: false });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/doctor") {
    send(response, { ok: true, fake: true, checks: [{ name: "fake explorer", ok: true }] });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/classes") {
    send(response, { classes: ["Object", "String"], truncated: false });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/roots") {
    send(response, { roots: ["UserGlobals"], entries: [{ key: "Smoke", value: "ok" }], truncated: false });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/globals") {
    send(response, { globals: [{ key: "Object", className: "Class", oop: "42" }], truncated: false });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/debug") {
    drain(request, () => send(response, debugPayload));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/debug/action") {
    drain(request, () => send(response, { ok: true, live: false, debugSessionId: "host-smoke-debug", result: "terminated" }));
    return;
  }
  send(response, { error: `Unhandled fake Explorer route: ${request.method} ${url.pathname}` }, 404);
});

server.listen(port, host, () => {
  console.log(`Fake gemstone-js Explorer listening on http://${host}:${port}`);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 250).unref();
}

function send(response, payload, statusCode = 200) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function drain(request, callback) {
  request.resume();
  request.on("end", callback);
}

function parseArgs(args) {
  const parsed = { host: "127.0.0.1", port: 3117 };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--host") parsed.host = args[index + 1] || parsed.host;
    if (args[index] === "--port") parsed.port = Number(args[index + 1] || parsed.port);
  }
  return parsed;
}

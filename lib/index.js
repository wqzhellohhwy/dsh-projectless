// src/index.ts
import { appendFile, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join as join2 } from "node:path";

// src/host/directories.ts
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

// src/shared/paths.ts
var DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;
var SESSION_DIRECTORY = /^session-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;
var IGNORABLE_DIRECTORY_ENTRIES = /* @__PURE__ */ new Set([
  ".DS_Store",
  ".localized",
  "Thumbs.db",
  "desktop.ini"
]);
function isIgnorableDirectoryEntry(name2) {
  return IGNORABLE_DIRECTORY_ENTRIES.has(name2) || name2.startsWith("._");
}
function normalizeFsPath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
function relativeParts(target, root) {
  const path = normalizeFsPath(target);
  const base = normalizeFsPath(root);
  if (base === "" || path === base || !path.startsWith(`${base}/`)) return void 0;
  return path.slice(base.length + 1).split("/");
}
function isManagedDateDirectoryPath(target, root) {
  const parts = relativeParts(target, root);
  return parts !== void 0 && parts.length === 1 && DATE_DIRECTORY.test(parts[0] ?? "");
}
function isManagedSessionPath(target, root) {
  const parts = relativeParts(target, root);
  return parts !== void 0 && parts.length === 2 && DATE_DIRECTORY.test(parts[0] ?? "") && SESSION_DIRECTORY.test(parts[1] ?? "");
}

// src/host/directories.ts
function localDateName(now) {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function sessionDirectoryName(now, suffix) {
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `session-${hour}-${minute}-${second}-${suffix}`;
}
function randomSuffix() {
  return randomBytes(4).toString("hex");
}
async function createProjectlessDirectory(root, now = /* @__PURE__ */ new Date(), suffix = randomSuffix()) {
  if (!isAbsolute(root)) throw new Error("projectless session root must be an absolute path");
  const dateDirectory = join(root, localDateName(now));
  await mkdir(dateDirectory, { recursive: true, mode: 448 });
  const sessionDirectory = join(dateDirectory, sessionDirectoryName(now, suffix));
  await mkdir(sessionDirectory, { mode: 448 });
  return sessionDirectory;
}
function isErrno(reason, code) {
  return typeof reason === "object" && reason !== null && "code" in reason && reason.code === code;
}
async function resolveProjectlessRoot(root) {
  if (!isAbsolute(root)) throw new Error("projectless session root must be an absolute path");
  try {
    return await realpath(root);
  } catch (reason) {
    if (isErrno(reason, "ENOENT")) return root;
    throw reason;
  }
}
function isOwnedSessionPath(target, root, resolvedRoot) {
  return isManagedSessionPath(target, root) || isManagedSessionPath(target, resolvedRoot);
}
function isOwnedDatePath(target, root, resolvedRoot) {
  return isManagedDateDirectoryPath(target, root) || isManagedDateDirectoryPath(target, resolvedRoot);
}
async function unlinkIgnorableFiles(directory, names) {
  for (const name2 of names) {
    const target = join(directory, name2);
    try {
      const info = await lstat(target);
      if (!info.isFile()) return false;
      await unlink(target);
    } catch (reason) {
      if (isErrno(reason, "ENOENT")) continue;
      return false;
    }
  }
  return true;
}
async function removeEmptyDirectory(path) {
  let entries;
  try {
    entries = await readdir(path);
  } catch (reason) {
    if (isErrno(reason, "ENOENT")) return "absent";
    throw reason;
  }
  const junk = entries.filter(isIgnorableDirectoryEntry);
  if (junk.length !== entries.length) return "retained";
  if (junk.length > 0 && !await unlinkIgnorableFiles(path, junk)) return "retained";
  try {
    await rmdir(path);
    return "removed";
  } catch (reason) {
    if (isErrno(reason, "ENOENT")) return "absent";
    if (isErrno(reason, "ENOTEMPTY") || isErrno(reason, "EEXIST")) return "retained";
    throw reason;
  }
}
async function removeUnusedProjectlessDirectory(root, requestedPath) {
  if (!isAbsolute(root) || !isAbsolute(requestedPath)) {
    throw new Error("projectless session path must be an absolute path");
  }
  const resolvedRoot = await resolveProjectlessRoot(root);
  if (!isOwnedSessionPath(requestedPath, root, resolvedRoot)) {
    throw new Error("path is not a projectless session directory");
  }
  let canonical;
  try {
    canonical = await realpath(requestedPath);
  } catch (reason) {
    if (isErrno(reason, "ENOENT")) return "absent";
    throw reason;
  }
  if (!isOwnedSessionPath(canonical, root, resolvedRoot)) {
    throw new Error("path is not a projectless session directory");
  }
  const result = await removeEmptyDirectory(canonical);
  if (result !== "removed") return result;
  const parent = dirname(canonical);
  if (isOwnedDatePath(parent, root, resolvedRoot)) {
    await removeEmptyDirectory(parent);
  }
  return "removed";
}

// src/shared/rpc.ts
var PROJECTLESS_RPC_CHANNEL = "/api";
var PROJECTLESS_RPC_PREFIX = "projectless";
var PROJECTLESS_ENDPOINTS = ["create-directory", "get-root", "remove-directory"];
var DIAGNOSTICS_ENDPOINT = "diagnostics";
function projectlessEndpoint(endpoint) {
  return `${PROJECTLESS_RPC_PREFIX}/${endpoint}`;
}
function diagnosticsEndpoint() {
  return `${PROJECTLESS_RPC_PREFIX}/${DIAGNOSTICS_ENDPOINT}`;
}

// src/index.ts
var name = "dsh-projectless";
var inject = ["connection"];
function pathPayload(payload) {
  if (typeof payload !== "object" || payload === null) return void 0;
  const path = payload.path;
  return typeof path === "string" ? path : void 0;
}
function badRequest(message) {
  return {
    ok: false,
    error: {
      code: "bad-request",
      message,
      details: { issues: [] }
    }
  };
}
function internalError(message) {
  return {
    ok: false,
    error: {
      code: "internal",
      message,
      details: {}
    }
  };
}
async function dispatchProjectlessEndpoint(root, endpoint, payload) {
  try {
    if (endpoint === "create-directory") {
      return { ok: true, value: { path: await createProjectlessDirectory(root) } };
    }
    if (endpoint === "get-root") {
      return { ok: true, value: { root: await resolveProjectlessRoot(root) } };
    }
    const path = pathPayload(payload);
    if (path === void 0) return badRequest("remove-directory requires { path }");
    return { ok: true, value: { result: await removeUnusedProjectlessDirectory(root, path) } };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes("absolute path") || message.includes("not a projectless")) {
      return badRequest(message);
    }
    return internalError(message);
  }
}
function envelope(rpcId, result) {
  return Response.json({ type: "server-response", rpcId, result });
}
async function decodeRequest(request, method) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return new Response("content type must be application/json", { status: 415 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  const message = body;
  if (typeof message !== "object" || message === null || message.type !== "client-request" || typeof message.rpcId !== "string") {
    return new Response("invalid client-request envelope", { status: 400 });
  }
  if (message.method !== method) {
    return envelope(message.rpcId, badRequest(`method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(method)}`));
  }
  return { rpcId: message.rpcId, payload: message.payload };
}
function createProjectlessFetch(root, endpoint) {
  const method = projectlessEndpoint(endpoint);
  return async (request) => {
    const decoded = await decodeRequest(request, method);
    if (decoded instanceof Response) return decoded;
    return envelope(decoded.rpcId, await dispatchProjectlessEndpoint(root, endpoint, decoded.payload));
  };
}
async function readCommands(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const commands = parsed?.commands;
    return Array.isArray(commands) ? commands.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}
function createDiagnosticsFetch(file, commandsFile) {
  const method = diagnosticsEndpoint();
  return async (request) => {
    const decoded = await decodeRequest(request, method);
    if (decoded instanceof Response) return decoded;
    try {
      const line = JSON.stringify({ receivedAt: (/* @__PURE__ */ new Date()).toISOString(), payload: decoded.payload });
      await appendFile(file, `${line}
`, "utf8");
    } catch {
    }
    return envelope(decoded.rpcId, { ok: true, value: { written: true, commands: await readCommands(commandsFile) } });
  };
}
function apply(ctx, config = {}) {
  const root = config.root ?? join2(homedir(), "Documents", "DSH");
  for (const endpoint of PROJECTLESS_ENDPOINTS) {
    const path2 = `${PROJECTLESS_RPC_CHANNEL}/${projectlessEndpoint(endpoint)}`;
    ctx.effect(() => ctx.connection.fetch.register({
      path: path2,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: createProjectlessFetch(root, endpoint)
    }), `${name}: ${path2}`);
  }
  if (config.diagnostics === false) return;
  const file = config.diagnosticsFile ?? join2(tmpdir(), "dsh-projectless-diagnostics.json");
  const commandsFile = config.commandsFile ?? join2(tmpdir(), "dsh-projectless-commands.json");
  const path = `${PROJECTLESS_RPC_CHANNEL}/${diagnosticsEndpoint()}`;
  ctx.effect(() => ctx.connection.fetch.register({
    path,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: createDiagnosticsFetch(file, commandsFile)
  }), `${name}: ${path}`);
}
export {
  apply,
  createDiagnosticsFetch,
  createProjectlessFetch,
  dispatchProjectlessEndpoint,
  inject,
  name,
  readCommands
};
//# sourceMappingURL=index.js.map

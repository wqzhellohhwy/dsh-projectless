// src/index.ts
import { appendFile, readFile } from "node:fs/promises";

// src/host/patches.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
async function readArchive(path) {
  try {
    const original = await import("original-fs");
    const fs = original.default ?? original;
    return fs.readFileSync(path, "latin1");
  } catch {
    return readFileSync(path, "latin1");
  }
}
var GATE_MARKER = 'workspaces.phase === "readx"';
var CHIP_MARKER = Buffer.from('"\u672A\u5206\u7EC4        "', "utf8").toString("latin1");
function resolveArchive() {
  const resources = process.resourcesPath;
  const candidates = [];
  if (typeof resources === "string" && resources !== "") {
    candidates.push(join(resources, "app.asar"));
  }
  try {
    const execDir = dirname(process.execPath);
    candidates.push(join(execDir, "resources", "app.asar"));
    candidates.push(join(execDir, "..", "resources", "app.asar"));
  } catch {
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
    }
  }
  return null;
}
async function detectPatchStatus() {
  const archive = resolveArchive();
  if (archive === null) {
    return {
      archive: null,
      readable: false,
      composerGate: false,
      composerChip: false,
      summary: "\u672A\u627E\u5230 app.asar\uFF08\u53EF\u80FD\u4E0D\u662F Desktop \u7248\uFF0C\u6216\u5B89\u88C5\u4F4D\u7F6E\u4E0D\u5E38\u89C1\uFF09"
    };
  }
  let text;
  try {
    text = await readArchive(archive);
  } catch (reason) {
    return {
      archive,
      readable: false,
      composerGate: false,
      composerChip: false,
      summary: `app.asar \u8BFB\u53D6\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`
    };
  }
  const composerGate = text.includes(GATE_MARKER);
  const composerChip = text.includes(CHIP_MARKER);
  const missing = [
    composerGate ? null : "\u8F93\u5165\u6846\u89E3\u9501",
    composerChip ? null : "\u6807\u7B7E\u6587\u6848"
  ].filter((value) => value !== null);
  return {
    archive,
    readable: true,
    composerGate,
    composerChip,
    summary: missing.length === 0 ? "\u4E24\u5904\u8865\u4E01\u5747\u5DF2\u751F\u6548" : `\u7F3A\u5C11\u8865\u4E01\uFF1A${missing.join("\u3001")} \u2014\u2014 \u8FD0\u884C tools/dsh-composer-gate/install-patches.mjs`
  };
}

// src/index.ts
import { homedir, tmpdir } from "node:os";
import { join as join3 } from "node:path";

// src/host/directories.ts
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, join as join2 } from "node:path";

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
  const dateDirectory = join2(root, localDateName(now));
  await mkdir(dateDirectory, { recursive: true, mode: 448 });
  const sessionDirectory = join2(dateDirectory, sessionDirectoryName(now, suffix));
  await mkdir(sessionDirectory, { mode: 448 });
  return sessionDirectory;
}
function isErrno(reason, code) {
  return typeof reason === "object" && reason !== null && "code" in reason && reason.code === code;
}
async function ensureGroupDirectory(root, name2) {
  if (!isAbsolute(root)) throw new Error("projectless session root must be an absolute path");
  if (name2 === "" || name2 === "." || name2 === "..") {
    throw new Error("projectless group name must be a plain directory name");
  }
  if (name2.includes("/") || name2.includes("\\") || name2.includes(":")) {
    throw new Error("projectless group name must be a plain directory name");
  }
  const resolvedRoot = await resolveProjectlessRoot(root);
  const target = join2(resolvedRoot, name2);
  await mkdir(target, { recursive: true, mode: 448 });
  return target;
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
    const target = join2(directory, name2);
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
  const parent = dirname2(canonical);
  if (isOwnedDatePath(parent, root, resolvedRoot)) {
    await removeEmptyDirectory(parent);
  }
  return "removed";
}

// src/shared/rpc.ts
var PROJECTLESS_RPC_CHANNEL = "/api";
var PROJECTLESS_RPC_PREFIX = "projectless";
var PROJECTLESS_ENDPOINTS = [
  "create-directory",
  "ensure-group-directory",
  "get-root",
  "remove-directory"
];
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
function namePayload(payload) {
  if (typeof payload !== "object" || payload === null) return void 0;
  const name2 = payload.name;
  return typeof name2 === "string" ? name2 : void 0;
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
    if (endpoint === "ensure-group-directory") {
      const name2 = namePayload(payload);
      if (name2 === void 0) return badRequest("ensure-group-directory requires { name }");
      return { ok: true, value: { path: await ensureGroupDirectory(root, name2) } };
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
  const root = config.root ?? join3(homedir(), "Documents", "DSH");
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
  const file = config.diagnosticsFile ?? join3(tmpdir(), "dsh-projectless-diagnostics.json");
  const commandsFile = config.commandsFile ?? join3(tmpdir(), "dsh-projectless-commands.json");
  if (config.patchCheck !== false) {
    ctx.effect(() => {
      void detectPatchStatus().then((status) => {
        const line = JSON.stringify({
          receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
          payload: { phase: "patch-check", plugin: name, ...status }
        });
        return appendFile(file, `${line}
`, "utf8").then(() => {
          if (!status.composerGate || !status.composerChip) console.warn(`${name}: ${status.summary}`);
        });
      }).catch(() => {
      });
      return () => {
      };
    }, `${name}: patch self-check`);
  }
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

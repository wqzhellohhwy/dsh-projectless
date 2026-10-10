window.__ModuleLoader__.load({ id: "dsh-projectless", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/shared/paths.ts
var DATE_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;
var SESSION_DIRECTORY = /^session-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;
function normalizeFsPath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
function relativeParts(target, root) {
  const path = normalizeFsPath(target);
  const base = normalizeFsPath(root);
  if (base === "" || path === base || !path.startsWith(`${base}/`)) return void 0;
  return path.slice(base.length + 1).split("/");
}
function isManagedSessionPath(target, root) {
  const parts = relativeParts(target, root);
  return parts !== void 0 && parts.length === 2 && DATE_DIRECTORY.test(parts[0] ?? "") && SESSION_DIRECTORY.test(parts[1] ?? "");
}
function isProjectlessPath(path) {
  const segments = normalizeFsPath(path).split("/").filter((segment) => segment.length > 0);
  const dateName = segments.at(-2);
  const sessionName = segments.at(-1);
  return dateName !== void 0 && sessionName !== void 0 && DATE_DIRECTORY.test(dateName) && SESSION_DIRECTORY.test(sessionName);
}

// src/shared/rpc.ts
var PROJECTLESS_RPC_CHANNEL = "/api";
var PROJECTLESS_RPC_PREFIX = "projectless";
var DIAGNOSTICS_ENDPOINT = "diagnostics";
function projectlessEndpoint(endpoint) {
  return `${PROJECTLESS_RPC_PREFIX}/${endpoint}`;
}
function diagnosticsEndpoint() {
  return `${PROJECTLESS_RPC_PREFIX}/${DIAGNOSTICS_ENDPOINT}`;
}

// src/client/session.ts
var MAIN_VIEW_SOURCE = "mainView";
function isCurrentSession(sessions, sessionId) {
  return (sessions.byId[sessionId]?.retainedBy?.[MAIN_VIEW_SOURCE] ?? 0) > 0;
}
function createAbandonClaim() {
  const claimed = /* @__PURE__ */ new Set();
  return {
    tryClaim(workspaceId) {
      if (claimed.has(workspaceId)) return false;
      claimed.add(workspaceId);
      return true;
    }
  };
}
var PROJECTLESS_ENTRY_ID = "::projectless-session";
function createProjectlessRegistry() {
  const ids = /* @__PURE__ */ new Set();
  return {
    remember(workspaceId) {
      ids.add(workspaceId);
    },
    has(workspaceId) {
      return ids.has(workspaceId);
    },
    ids() {
      return [...ids];
    }
  };
}
function resolvePickerSelection(items, selectedId, isProjectless) {
  const projects = [];
  let projectlessActive = false;
  for (const row of items) {
    if (isProjectless(row)) {
      if (selectedId !== void 0 && row.workspaceId === selectedId) projectlessActive = true;
      continue;
    }
    projects.push(row);
  }
  return {
    projects,
    selectedId: projectlessActive ? PROJECTLESS_ENTRY_ID : selectedId,
    projectlessActive
  };
}
function rpcValue(result, label) {
  if (!result.ok) throw new Error(result.error?.message ?? `${label} failed`);
  return result.value;
}
function expectPathObject(value, key, label) {
  if (typeof value !== "object" || value === null || typeof value[key] !== "string") {
    throw new Error(`${label} returned an invalid directory response`);
  }
  return value[key];
}
async function requestProjectlessDirectory(rpc) {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint("create-directory"), {}), "projectless session Host"),
    "path",
    "projectless session Host"
  );
}
async function requestProjectlessRoot(rpc) {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint("get-root"), {}), "projectless session Host"),
    "root",
    "projectless session Host"
  );
}
async function requestRemoveProjectlessDirectory(rpc, path) {
  rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint("remove-directory"), { path }), "projectless session Host");
}
async function createAndOpenProjectlessSession(workspaces, sessions, provisionDirectory, registry, removeDirectory = async () => {
}, pending) {
  const path = await provisionDirectory();
  const workspace = await workspaces.create({ path });
  registry?.remember(workspace.workspaceId);
  pending?.add(workspace.workspaceId);
  try {
    const sessionId = await workspaces.connectWorkspace(workspace.workspaceId);
    sessions.open(sessionId);
    return { sessionId, workspaceId: workspace.workspaceId, path };
  } catch (reason) {
    pending?.delete(workspace.workspaceId);
    await workspaces.delete(workspace.workspaceId).catch(() => {
    });
    await removeDirectory(path).catch(() => {
    });
    throw reason;
  }
}
async function abandonUnusedProjectlessWorkspace(workspaces, target, removeDirectory, onError = console.error) {
  for (const sessionId of target.sessionIds) {
    await workspaces.archiveSession(sessionId).catch(onError);
  }
  await workspaces.delete(target.workspaceId).catch(onError);
  await removeDirectory(target.path).catch(onError);
}
function isUnusedProjectlessWorkspace(workspace, sessions, root, skip = /* @__PURE__ */ new Set(), temporaryLabel) {
  if (skip.has(workspace.workspaceId) || !isManagedSessionPath(workspace.path, root)) return false;
  if (temporaryLabel !== void 0 && workspace.title !== temporaryLabel) return false;
  if (workspace.sessionIds.length === 0) return false;
  for (const sessionId of workspace.sessionIds) {
    if (isCurrentSession(sessions, sessionId)) return false;
    const row = sessions.byId[sessionId];
    if (row === void 0 || row.blank !== true) return false;
  }
  return true;
}
function findUnusedProjectlessWorkspaces(workspaces, sessions, root, skip, temporaryLabel) {
  return workspaces.filter((workspace) => isUnusedProjectlessWorkspace(workspace, sessions, root, skip, temporaryLabel)).map((workspace) => ({
    workspaceId: workspace.workspaceId,
    path: workspace.path,
    sessionIds: workspace.sessionIds
  }));
}
function watchTemporaryWorkspace(workspaces, sessions, receipt, onError = console.error) {
  let active = true;
  let unsubscribe = () => {
  };
  const reconcile = () => {
    if (!active || sessions.list.getSnapshot().byId[receipt.sessionId]?.blank !== false) return;
    active = false;
    unsubscribe();
    void workspaces.delete(receipt.workspaceId).catch(onError);
  };
  unsubscribe = sessions.list.subscribe(reconcile);
  reconcile();
  return () => {
    active = false;
    unsubscribe();
  };
}
function reclaimUnusedProjectlessWorkspaces(workspaces, sessions, root, removeDirectory, registry, pending, claim, onError = console.error) {
  const owned = new Set(registry.ids());
  if (owned.size === 0) return;
  const state = workspaces.list.getSnapshot();
  if (state.phase === "pending") return;
  for (const unused of findUnusedProjectlessWorkspaces(
    state.items,
    sessions.list.getSnapshot(),
    root,
    pending
  )) {
    if (!owned.has(unused.workspaceId)) continue;
    if (!claim.tryClaim(unused.workspaceId)) continue;
    void abandonUnusedProjectlessWorkspace(workspaces, unused, removeDirectory, onError);
  }
}
function sweepLeftoverProjectlessWorkspaces(workspaces, sessions, root, removeDirectory, registry, pending, claim, temporaryLabel, onError = console.error) {
  let active = true;
  const reconcile = () => {
    if (!active) return;
    const workspaceState = workspaces.list.getSnapshot();
    if (workspaceState.phase === "pending") return;
    const skip = /* @__PURE__ */ new Set([...registry.ids(), ...pending]);
    for (const leftover of findUnusedProjectlessWorkspaces(
      workspaceState.items,
      sessions.list.getSnapshot(),
      root,
      skip,
      temporaryLabel
    )) {
      if (!claim.tryClaim(leftover.workspaceId)) continue;
      void abandonUnusedProjectlessWorkspace(workspaces, leftover, removeDirectory, onError);
    }
  };
  const unsubscribeWorkspaces = workspaces.list.subscribe(reconcile);
  const unsubscribeSessions = sessions.list.subscribe(reconcile);
  reconcile();
  return () => {
    active = false;
    unsubscribeWorkspaces();
    unsubscribeSessions();
  };
}

// src/client/diagnostics.ts
async function report(ctx, payload) {
  try {
    const rpc = ctx.connection?.rpc;
    if (rpc === void 0 || typeof rpc.call !== "function") return void 0;
    const result = await rpc.call(PROJECTLESS_RPC_CHANNEL, diagnosticsEndpoint(), { ...payload, at: Date.now() });
    return result?.value;
  } catch {
    return void 0;
  }
}

// src/client/selftest.ts
var MARK_PREFIX = "DSH-PROJECTLESS-DRAFT-PROBE";
function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
function readDraft(sessionId) {
  try {
    const raw = localStorage.getItem(`dsh.conversation.${sessionId}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.draft === "string" ? parsed.draft : null;
  } catch {
    return null;
  }
}
function findComposer() {
  for (const selector of ["textarea", '[contenteditable="true"]', '[role="textbox"]']) {
    const found = document.querySelector(selector);
    if (found !== null) return found;
  }
  return void 0;
}
function composerText(element) {
  if (element === void 0) return "";
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
  return element.textContent ?? "";
}
function typeInto(element, text) {
  try {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return "textarea-value";
    }
    if (element instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return "input-value";
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) {
      return "execCommand";
    }
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    return "textContent";
  } catch (reason) {
    return `failed:${String(reason).slice(0, 80)}`;
  }
}
async function runDraftSelftest(ctx, deps) {
  const mark = `${MARK_PREFIX}-${Date.now().toString(36)}`;
  const startedFrom = deps.snapshot().current;
  let target;
  let result = { mark, startedFrom: startedFrom ?? null };
  try {
    target = await deps.createProjectlessSession();
    result.createdSession = target;
    await wait(1500);
    const composer = findComposer();
    result.currentAfterCreate = deps.snapshot().current ?? null;
    result.composer = composer === void 0 ? null : `${composer.tagName}.${String(composer.className).slice(0, 60)}`;
    if (composer !== void 0) result.typed = typeInto(composer, mark);
    await wait(1e3);
    result.draftAfterTyping = readDraft(target);
    if (startedFrom !== void 0) deps.openSession(startedFrom);
    await wait(1600);
    result.afterLeaving = {
      current: deps.snapshot().current ?? null,
      blank: deps.snapshot().blank(target) ?? null,
      workspaceKept: deps.hasProjectlessWorkspace(target),
      draft: readDraft(target)
    };
    deps.openSession(target);
    await wait(1800);
    const returned = {
      current: deps.snapshot().current ?? null,
      composerText: composerText(findComposer()),
      draft: readDraft(target)
    };
    result.afterReturning = returned;
    result.restored = returned.composerText.includes(mark) || returned.draft === mark;
  } catch (reason) {
    result.error = String(reason).slice(0, 300);
  } finally {
    if (startedFrom !== void 0) {
      try {
        deps.openSession(startedFrom);
      } catch {
      }
    }
    report(ctx, { phase: "draft-selftest", ...result });
  }
}

// src/client/locales.ts
var PROJECTLESS_LOCALE_NS = "projectless";
var zh = {
  "picker.projectless": "\u65E0\u5DE5\u4F5C\u533A\u4F1A\u8BDD",
  "picker.addWorkspace": "\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026",
  "modal.createFailed": "\u65E0\u6CD5\u521B\u5EFA\u65E0\u5DE5\u4F5C\u533A\u4F1A\u8BDD",
  "modal.close": "\u77E5\u9053\u4E86"
};
var en = {
  "picker.projectless": "Session without workspace",
  "picker.addWorkspace": "Add workspace\u2026",
  "modal.createFailed": "Could not create session without workspace",
  "modal.close": "Got it"
};
var projectlessLocales = {
  zh,
  en
};

// src/client/sidebar.ts
var SIDEBAR_SLOT = "sidebar.workspaces";
var TREE = '[role="tree"]:has([data-row-key="workspace:"])';
var TEMP_ATTR = "data-dsh-projectless-temp";
var CSS = [
  "/* dsh-projectless: keep Ungrouped above every workspace group, and the */",
  "/* projectless temporary Workspace above Ungrouped while it exists.      */",
  `${TREE}{display:flex;flex-direction:column}`,
  `${TREE}>*{flex:0 0 auto}`,
  `${TREE}>div:has([data-row-key="workspace:"]){order:-1}`,
  `${TREE}>div[${TEMP_ATTR}]{order:-2}`
].join("\n");
function projectlessLabel(ctx) {
  try {
    const label = ctx.locale.bind(PROJECTLESS_LOCALE_NS)("picker.projectless");
    if (typeof label === "string" && label !== "") return label;
  } catch {
  }
  return void 0;
}
function baseName(path) {
  const segments = path.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}
function installStyles(ctx, pluginName) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = pluginName;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, `${pluginName}: sidebar styles`);
}
function markTemporaryGroups(ctx, pluginName) {
  ctx.effect(() => {
    const mark = () => {
      const label = projectlessLabel(ctx);
      if (label === void 0) return;
      let sections;
      try {
        sections = document.querySelectorAll('[role="tree"] > div');
      } catch {
        return;
      }
      for (const section of sections) {
        let row;
        try {
          row = section.querySelector('[data-row-key^="workspace:"]');
        } catch {
          continue;
        }
        const text = row === null ? "" : String(row.textContent ?? "").trim();
        if (text === label) section.setAttribute(TEMP_ATTR, "1");
        else section.removeAttribute(TEMP_ATTR);
      }
    };
    const schedule = () => {
      window.setTimeout(mark, 0);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(mark);
    };
    let unsubscribe = () => {
    };
    try {
      unsubscribe = ctx.workspaces.list.subscribe(schedule) || (() => {
      });
    } catch {
    }
    schedule();
    return () => {
      try {
        unsubscribe();
      } catch {
      }
      try {
        for (const section of document.querySelectorAll(`[${TEMP_ATTR}]`)) section.removeAttribute(TEMP_ATTR);
      } catch {
      }
    };
  }, `${pluginName}: tag the temporary workspace section`);
}
function watchTemporaryLabel(ctx, label) {
  if (label === void 0) return () => {
  };
  let stopped = false;
  const fix = () => {
    if (stopped) return;
    let items;
    try {
      items = ctx.workspaces.list.getSnapshot().items ?? [];
    } catch {
      return;
    }
    for (const workspace of items) {
      if (!isProjectlessPath(workspace.path)) continue;
      if (workspace.title === label) continue;
      if (workspace.title !== baseName(workspace.path)) continue;
      try {
        void ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {
        });
      } catch {
      }
    }
  };
  let unsubscribe = () => {
  };
  try {
    unsubscribe = ctx.workspaces.list.subscribe(fix) || (() => {
    });
  } catch {
  }
  fix();
  return () => {
    stopped = true;
    try {
      unsubscribe();
    } catch {
    }
  };
}
function reconcileLabel(ctx, sessionId, label) {
  if (label === void 0) return;
  const attempt = (remaining) => {
    let workspace;
    try {
      workspace = (ctx.workspaces.list.getSnapshot().items ?? []).find((item) => item.sessionIds.includes(sessionId));
    } catch {
      workspace = void 0;
    }
    if (workspace !== void 0) {
      if (!isProjectlessPath(workspace.path)) return;
      if (workspace.title === label) return;
      try {
        void ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {
        });
      } catch {
      }
    }
    if (remaining > 0) window.setTimeout(() => {
      attempt(remaining - 1);
    }, 400);
  };
  attempt(5);
}
function workspaceViewInstance(ctx) {
  let entries;
  try {
    entries = ctx.slots.entries(SIDEBAR_SLOT);
  } catch {
    return void 0;
  }
  for (const entry of entries ?? []) {
    const store = entry?.options?.store ?? entry?.store;
    if (store === void 0 || typeof store.create !== "function") continue;
    try {
      const instance = store.create();
      if (instance === void 0 || instance === null) continue;
      if (instance.store === void 0 || typeof instance.store.update !== "function") continue;
      if (typeof instance.getSnapshot !== "function") continue;
      return instance;
    } catch {
    }
  }
  return void 0;
}
function recencyOrders(ctx) {
  const sessions = ctx.sessions.list.getSnapshot();
  const workspaces = ctx.workspaces.list.getSnapshot();
  const byRecency = (ids) => (ids ?? []).filter((id) => sessions.byId[id] !== void 0).slice().sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));
  const orders = {};
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of workspaces.items ?? []) {
    for (const id of workspace.sessionIds ?? []) accounted.add(id);
    orders[workspace.workspaceId] = byRecency(workspace.sessionIds);
  }
  orders[""] = byRecency((sessions.ids ?? []).filter((id) => !accounted.has(id)));
  return orders;
}
function sameOrder(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
function keepRecencyOrder(ctx, pluginName) {
  ctx.effect(() => {
    let view;
    let disposed = false;
    let disposers = [];
    let timers = [];
    let warned = false;
    const sync = () => {
      if (disposed || view === void 0) return;
      let snapshot;
      try {
        snapshot = view.getSnapshot();
      } catch {
        return;
      }
      if (snapshot === void 0 || snapshot.orderBy !== "manual") return;
      const stored = snapshot.sessionOrderByAccount;
      if (stored === void 0) return;
      const changed = {};
      for (const [account, order] of Object.entries(recencyOrders(ctx))) {
        const current = stored[account];
        if (!Array.isArray(current) || sameOrder(current, order)) continue;
        changed[account] = order;
      }
      if (Object.keys(changed).length === 0) return;
      try {
        view.store.update((draft) => {
          if (draft.sessionOrderByAccount === void 0) draft.sessionOrderByAccount = {};
          for (const [account, order] of Object.entries(changed)) draft.sessionOrderByAccount[account] = [...order];
        });
      } catch (reason) {
        console.warn(`${pluginName}: cannot refresh a stored order:`, reason);
      }
    };
    const attach = () => {
      if (disposed || view !== void 0) return;
      const found = workspaceViewInstance(ctx);
      if (found === void 0) return;
      view = found;
      try {
        disposers.push(ctx.sessions.list.subscribe(sync));
      } catch {
      }
      try {
        disposers.push(view.subscribe(sync));
      } catch {
      }
      sync();
    };
    const attachOnce = () => {
      attach();
      if (view === void 0) {
        if (!warned) {
          warned = true;
          console.warn(`${pluginName}: sidebar view store not found yet; will keep retrying`);
        }
        return;
      }
      for (const timer of timers) window.clearTimeout(timer);
      timers = [];
    };
    let stopSlots = () => {
    };
    try {
      stopSlots = ctx.slots.subscribe(SIDEBAR_SLOT, attachOnce) || (() => {
      });
    } catch {
    }
    attachOnce();
    for (const delay of [250, 1e3, 3e3, 8e3]) timers.push(window.setTimeout(attachOnce, delay));
    return () => {
      disposed = true;
      for (const timer of timers) window.clearTimeout(timer);
      timers = [];
      try {
        stopSlots();
      } catch {
      }
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
        }
      }
      disposers = [];
      view = void 0;
    };
  }, `${pluginName}: keep every group in recency order`);
}
function installDefaultNewSession(ctx, pluginName, startProjectless) {
  ctx.effect(() => {
    const ui = ctx.uiWorkspace;
    let fallback = ui.startSession;
    if (typeof fallback !== "function") return () => {
    };
    let inFlight = false;
    const patched = function(workspaceId) {
      if (workspaceId !== void 0) {
        report(ctx, { phase: "startSession", mode: "explicit-workspace" });
        return fallback.call(ui, workspaceId);
      }
      report(ctx, { phase: "startSession", mode: "default" });
      if (inFlight) return void 0;
      inFlight = true;
      void Promise.resolve().then(() => startProjectless()).catch((reason) => {
        console.warn(`${pluginName}: projectless session failed:`, reason);
      }).finally(() => {
        inFlight = false;
      });
      return void 0;
    };
    patched.__dshProjectless = true;
    const install = () => {
      if (ui.startSession === patched) return;
      const current = ui.startSession;
      if (typeof current !== "function") return;
      if (current.__dshProjectless !== true) fallback = current;
      try {
        ui.startSession = patched;
      } catch (reason) {
        console.warn(`${pluginName}: cannot override startSession:`, reason);
      }
    };
    install();
    const guard = window.setInterval(install, 2e3);
    return () => {
      window.clearInterval(guard);
      if (ui.startSession === patched) {
        try {
          ui.startSession = fallback;
        } catch {
        }
      }
    };
  }, `${pluginName}: default new session to projectless`);
}

// src/client/index.tsx
var PACKAGE_ID = "dsh-projectless";
var VERSION = "1.0.0";
var BUILD = 3;
var FORCE_DRAFT_SELFTEST = false;
var PROJECTLESS = PROJECTLESS_ENTRY_ID;
var ADD_WORKSPACE = "::add-workspace";
var DSH_DIRECTORY_FLOW = "conversation.hero.workspace.directoryFlow";
var DIRECTORY_FLOW = "dsh-projectless.directoryFlow";
function errorMessage(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}
function ProjectlessWorkspacePicker({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  createWorkspace,
  createProjectlessSession,
  isProjectlessWorkspace,
  useDirectoryFlow,
  renderSlot,
  t
}) {
  const workspaceState = useWorkspaces((state) => state);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [flowOpen, setFlowOpen] = (0, import_react.useState)(false);
  const [modalError, setModalError] = (0, import_react.useState)(null);
  const getAnchorRect = (0, import_react.useCallback)(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef]
  );
  const selection = resolvePickerSelection(
    workspaceState.items,
    selectedId,
    isProjectlessWorkspace
  );
  const workspaceItems = selection.projects.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 16 }),
    disabled: busy
  }));
  const flowAvailable = useDirectoryFlow((occupied) => occupied);
  (0, import_react.useEffect)(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false);
  }, [flowOpen, flowAvailable]);
  const footer = [
    {
      id: PROJECTLESS,
      label: t("picker.projectless"),
      icon: /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 16 }),
      disabled: busy
    },
    ...flowAvailable ? [
      { type: "separator", id: "projectless-separator" },
      {
        id: ADD_WORKSPACE,
        label: t("picker.addWorkspace"),
        icon: /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
        disabled: busy
      }
    ] : []
  ];
  const run = (operation) => {
    if (busy) return;
    setBusy(true);
    void operation().catch((reason) => {
      setModalError(errorMessage(reason));
    }).finally(() => {
      setBusy(false);
    });
  };
  const handleSelect = (id) => {
    if (id === PROJECTLESS) {
      onClose();
      run(async () => {
        await createProjectlessSession();
      });
      return;
    }
    if (id === ADD_WORKSPACE) {
      onClose();
      setModalError(null);
      setFlowOpen(true);
      return;
    }
    onPick(id);
  };
  const directoryFlowOwner = {
    open: flowOpen,
    busy,
    onPicked: (path) => {
      run(async () => {
        try {
          const workspace = await createWorkspace({ path });
          onPick(workspace.workspaceId);
        } finally {
          setFlowOpen(false);
        }
      });
    },
    onCancel: () => {
      setFlowOpen(false);
    },
    onError: (message) => {
      setFlowOpen(false);
      setModalError(message);
    }
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    import_dsh_client_ui_primitives.Menu,
    {
      open,
      anchor: null,
      items: workspaceItems,
      footer,
      selectedId: selection.selectedId,
      onSelect: handleSelect,
      onClose,
      side: "bottom",
      portal: true,
      getAnchorRect
    }
  ), renderSlot(DIRECTORY_FLOW, directoryFlowOwner), /* @__PURE__ */ React.createElement(
    import_dsh_client_ui_primitives.Modal,
    {
      open: modalError !== null,
      onClose: () => {
        setModalError(null);
      },
      closeLabel: t("modal.close"),
      title: t("modal.createFailed"),
      footer: /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", onClick: () => {
        setModalError(null);
      } }, t("modal.close"))
    },
    /* @__PURE__ */ React.createElement("div", { className: "dsh-projectless-error", role: "alert" }, modalError)
  ));
}
function installPickerCss() {
  const style = document.createElement("style");
  style.dataset.plugin = PACKAGE_ID;
  style.textContent = `
    .dsh-projectless-error {
      margin-top: 8px;
      color: var(--dsw-alias-state-error-primary);
      font-size: 12px;
      line-height: 18px;
      overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}
function mirrorDirectoryFlow(slots) {
  const register = slots.register.bind(slots);
  let mirrored;
  let disposers = [];
  const release = () => {
    for (const dispose of disposers) dispose();
    disposers = [];
  };
  const sync = () => {
    const entries = slots.entries(DSH_DIRECTORY_FLOW);
    if (entries === mirrored) return;
    mirrored = entries;
    release();
    disposers = entries.map((entry) => register({
      name: DIRECTORY_FLOW,
      ...entry.options.priority === void 0 ? {} : { priority: entry.options.priority },
      ...entry.inject === void 0 ? {} : { inject: entry.inject },
      ...entry.locale === void 0 ? {} : { locale: entry.locale }
    }, entry.component));
  };
  const unsubscribe = slots.subscribe(DSH_DIRECTORY_FLOW, sync);
  sync();
  return () => {
    unsubscribe();
    release();
  };
}
var name = PACKAGE_ID;
var inject = ["connection", "locale", "slots", "sessions", "workspaces", "uiWorkspace"];
function projectlessHost(ctx) {
  const workspaces = ctx.workspaces;
  const ui = ctx.uiWorkspace;
  const sessions = {
    list: ctx.sessions.list,
    open: (sessionId) => {
      ui.openSession(sessionId);
    }
  };
  const host = {
    list: workspaces.list,
    create: (input) => workspaces.create(input),
    delete: (workspaceId) => workspaces.delete(workspaceId),
    rename: (workspaceId, title) => workspaces.rename(workspaceId, title),
    connectWorkspace: (workspaceId) => ui.connectWorkspace(workspaceId),
    archiveSession: (sessionId) => ui.archiveSession(sessionId)
  };
  return { host, sessions };
}
async function selfCheck(ctx, phase) {
  let orderBy = null;
  let storedAccounts = null;
  try {
    const view = sidebarViewFor(ctx);
    if (view !== void 0) {
      const snapshot = view.getSnapshot();
      orderBy = snapshot.orderBy ?? null;
      const stores = snapshot.sessionOrderByAccount ?? {};
      const recency = recencyOrders(ctx);
      storedAccounts = Object.fromEntries(Object.entries(stores).map(([key, value]) => {
        const stored = Array.isArray(value) ? value : [];
        const target = recency[key] ?? [];
        return [key === "" ? "(ungrouped)" : key.slice(0, 8), {
          members: stored.length,
          outOfRecency: stored.filter((id, index) => id !== target[index]).length
        }];
      }));
    }
  } catch {
  }
  let sidebarSections = -1;
  let taggedTemporarySections = -1;
  try {
    sidebarSections = document.querySelectorAll('[role="tree"] > div').length;
    taggedTemporarySections = document.querySelectorAll("[data-dsh-projectless-temp]").length;
  } catch {
  }
  const ui = ctx.uiWorkspace;
  let blankCount = 0;
  let blankProjectless = 0;
  try {
    const sessions = ctx.sessions.list.getSnapshot();
    for (const id of sessions.ids ?? []) {
      if (sessions.byId[id]?.blank !== true) continue;
      blankCount += 1;
    }
    for (const workspace of ctx.workspaces.list.getSnapshot().items ?? []) {
      if (!isProjectlessPath(workspace.path)) continue;
      if (workspace.sessionIds.some((id) => sessions.byId[id]?.blank === true)) blankProjectless += 1;
    }
  } catch {
  }
  return await report(ctx, {
    phase,
    plugin: `${PACKAGE_ID}@${VERSION}`,
    build: BUILD,
    url: String((typeof location === "undefined" ? void 0 : location.href) ?? ""),
    wrapperInstalled: typeof ui?.startSession === "function" && ui.startSession.__dshProjectless === true,
    label: projectlessLabel(ctx) ?? null,
    orderBy,
    storedAccounts,
    sidebarSections,
    taggedTemporarySections,
    blankCount,
    blankProjectless
  });
}
function sidebarViewFor(ctx) {
  try {
    for (const entry of ctx.slots.entries("sidebar.workspaces") ?? []) {
      const store = entry.options?.store ?? entry.store;
      if (store === void 0) continue;
      const instance = store.create?.();
      if (instance === void 0 || instance === null) continue;
      const candidate = instance;
      if (typeof candidate.getSnapshot !== "function" || candidate.store === void 0) continue;
      return candidate;
    }
  } catch {
  }
  return void 0;
}
function apply(ctx) {
  console.info(`${PACKAGE_ID}: client face applied`);
  const { host, sessions } = projectlessHost(ctx);
  const registry = createProjectlessRegistry();
  const pendingWorkspaceIds = /* @__PURE__ */ new Set();
  const claim = createAbandonClaim();
  const rpc = ctx.connection.rpc;
  const removeDirectory = (path) => requestRemoveProjectlessDirectory(rpc, path);
  const isProjectlessWorkspace = (workspace) => registry.has(workspace.workspaceId) || isProjectlessPath(workspace.path);
  let rootPromise;
  const projectlessRoot = () => rootPromise ??= requestProjectlessRoot(rpc);
  ctx.effect(installPickerCss, `${PACKAGE_ID}: picker styles`);
  ctx.effect(
    () => ctx.locale.register(PROJECTLESS_LOCALE_NS, projectlessLocales),
    `${PACKAGE_ID}: dictionaries`
  );
  const directoryFlow = {
    getSnapshot: () => ctx.slots.entries(DIRECTORY_FLOW).length > 0,
    subscribe: (listener) => ctx.slots.subscribe(DIRECTORY_FLOW, listener)
  };
  const scheduleReclaim = () => {
    window.setTimeout(() => {
      void projectlessRoot().then((root) => {
        reclaimUnusedProjectlessWorkspaces(
          host,
          sessions,
          root,
          removeDirectory,
          registry,
          pendingWorkspaceIds,
          claim
        );
      }).catch(() => {
      });
    }, 1200);
  };
  const createProjectlessSession = async () => {
    const label = projectlessLabel(ctx);
    const stopLabelWatch = watchTemporaryLabel(ctx, label);
    let receipt;
    try {
      receipt = await createAndOpenProjectlessSession(
        host,
        sessions,
        () => requestProjectlessDirectory(rpc),
        registry,
        removeDirectory,
        pendingWorkspaceIds
      );
    } finally {
      window.setTimeout(stopLabelWatch, 2e3);
    }
    if (label !== void 0) await host.rename(receipt.workspaceId, label).catch(() => {
    });
    ctx.effect(
      () => {
        const stop = watchTemporaryWorkspace(host, sessions, receipt);
        pendingWorkspaceIds.delete(receipt.workspaceId);
        return stop;
      },
      `${PACKAGE_ID}: watch ${receipt.sessionId} temporary workspace`
    );
    reconcileLabel(ctx, receipt.sessionId, label);
    scheduleReclaim();
    return receipt.sessionId;
  };
  ctx.effect(() => {
    let disposed = false;
    let stopSweep = () => {
    };
    void projectlessRoot().then((root) => {
      if (disposed) return;
      stopSweep = sweepLeftoverProjectlessWorkspaces(
        host,
        sessions,
        root,
        removeDirectory,
        registry,
        pendingWorkspaceIds,
        claim,
        projectlessLabel(ctx)
      );
    }).catch(console.error);
    return () => {
      disposed = true;
      stopSweep();
    };
  }, `${PACKAGE_ID}: sweep leftover blank workspaces`);
  installStyles(ctx, PACKAGE_ID);
  markTemporaryGroups(ctx, PACKAGE_ID);
  keepRecencyOrder(ctx, PACKAGE_ID);
  installDefaultNewSession(ctx, PACKAGE_ID, createProjectlessSession);
  const actions = () => ({
    createWorkspace: (input) => host.create(input),
    isProjectlessWorkspace,
    hooks: { directoryFlow },
    createProjectlessSession
  });
  ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register(
    {
      name: "conversation.hero.workspace",
      priority: -1,
      children: {
        [DIRECTORY_FLOW]: { kind: "single", scope: "root" }
      },
      inject: actions,
      locale: PROJECTLESS_LOCALE_NS
    },
    ProjectlessWorkspacePicker
  ));
  ctx.slots.inject(DIRECTORY_FLOW, () => mirrorDirectoryFlow(ctx.slots));
  window.setTimeout(() => {
    void selfCheck(ctx, "applied").then((reply) => {
      if (!FORCE_DRAFT_SELFTEST && !(reply?.commands ?? []).includes("draft-selftest")) return;
      void runDraftSelftest(ctx, {
        createProjectlessSession,
        openSession: (sessionId) => {
          ctx.uiWorkspace.openSession(sessionId);
        },
        snapshot: () => {
          const sessions2 = ctx.sessions.list.getSnapshot();
          const current = (sessions2.ids ?? []).find((id) => (sessions2.byId[id]?.retainedBy?.mainView ?? 0) > 0);
          return { current, blank: (id) => sessions2.byId[id]?.blank };
        },
        hasProjectlessWorkspace: (sessionId) => (ctx.workspaces.list.getSnapshot().items ?? []).some((workspace) => isProjectlessPath(workspace.path) && workspace.sessionIds.includes(sessionId))
      });
    });
  }, 2500);
}
return module.exports; } });
//# sourceMappingURL=client.js.map

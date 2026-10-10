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
var React2 = __toESM(require("react"), 1);
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

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
var PROJECTLESS_ENTRY_ID = "::projectless-session";
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
async function requestGroupDirectory(rpc, name2) {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint("ensure-group-directory"), { name: name2 }), "projectless Host"),
    "path",
    "projectless Host"
  );
}
async function requestProjectlessRoot(rpc) {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint("get-root"), {}), "projectless Host"),
    "root",
    "projectless Host"
  );
}
async function createProjectlessSession(deps) {
  const cwd = await deps.ensureGroupDirectory();
  const list = deps.listSessions();
  const reusable = list.ids.find((id) => list.isBlank(id) === true && list.cwdOf(id) === cwd && !deps.hasWorkspace(id));
  if (reusable !== void 0) {
    deps.openSession(reusable);
    return { sessionId: reusable, cwd, reused: true };
  }
  const sessionId = await deps.sessions.create({ cwd });
  deps.openSession(sessionId);
  return { sessionId, cwd, reused: false };
}
function workspaceOfSession(workspaces, sessionId) {
  return workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId;
}

// src/client/composer.ts
var React = __toESM(require("react"), 1);
var COMPOSER_BAR_SLOT = "conversation.composer.bar";
function isRenderable(value) {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value;
}
function installComposerGate(ctx, pluginName, deps, stats) {
  let builtin;
  const trace = [];
  const ComposerGate = (props) => {
    stats.rendered += 1;
    if (!isRenderable(builtin)) return null;
    const sessionId = props.sessionId ?? props.projectlessSessionId;
    const cwd = sessionId === void 0 ? void 0 : deps.cwdOf(sessionId);
    const owned = sessionId === void 0 ? void 0 : deps.hasWorkspace(sessionId);
    const identified = sessionId !== void 0 && owned === false && typeof cwd === "string" && cwd !== "";
    let orphans = [];
    try {
      orphans = deps.liveOrphans();
    } catch {
      orphans = [];
    }
    const parentless = identified || sessionId === void 0 && orphans.length > 0;
    trace.push(`${sessionId === void 0 ? "nil" : String(sessionId).slice(8, 16)}/${props.disabled === true ? "D" : "-"}/${orphans.length}`);
    if (trace.length > 8) trace.shift();
    stats.probe = trace.join(" ");
    if (!parentless || props.disabled !== true) return React.createElement(builtin, props);
    stats.opened += 1;
    const next = { ...props, disabled: false, workspacePickerOpen: false };
    delete next.onRequestWorkspace;
    const t = props.t;
    if (typeof t === "function") {
      try {
        next.placeholder = t("placeholder.hero");
      } catch {
      }
    } else {
      delete next.placeholder;
    }
    return React.createElement(builtin, next);
  };
  ctx.effect(() => {
    let dispose;
    let borrowed;
    const sync = () => {
      stats.syncs += 1;
      let entries;
      try {
        entries = [...ctx.slots.entries(COMPOSER_BAR_SLOT) ?? []];
      } catch (reason) {
        stats.lastError = `entries: ${String(reason).slice(0, 100)}`;
        return;
      }
      stats.entriesSeen = entries.length;
      const found = entries.find((entry) => isRenderable(entry.component) && entry.component !== ComposerGate);
      if (found === void 0) return;
      if (dispose !== void 0 && borrowed === found.component) return;
      builtin = found.component;
      borrowed = found.component;
      stats.borrowed = true;
      const options = {
        name: COMPOSER_BAR_SLOT,
        priority: -1
      };
      if (found.options?.children !== void 0) options.children = found.options.children;
      if (found.locale !== void 0) options.locale = found.locale;
      const upstream = found.inject;
      options.inject = (sessionId) => ({
        ...typeof upstream === "function" ? upstream(sessionId) : {},
        projectlessSessionId: sessionId
      });
      try {
        dispose?.();
      } catch {
      }
      try {
        dispose = ctx.slots.register(options, ComposerGate);
        stats.registered = true;
      } catch (reason) {
        dispose = void 0;
        stats.registered = false;
        stats.lastError = `register: ${String(reason).slice(0, 140)}`;
        console.warn(`${pluginName}: cannot register the composer gate:`, reason);
      }
    };
    let unsubscribe = () => {
    };
    try {
      unsubscribe = ctx.slots.subscribe(COMPOSER_BAR_SLOT, sync) || (() => {
      });
    } catch (reason) {
      stats.lastError = `subscribe: ${String(reason).slice(0, 100)}`;
    }
    const timers = [200, 800, 2e3, 5e3, 1e4].map((delay) => window.setTimeout(sync, delay));
    const interval = window.setInterval(sync, 5e3);
    sync();
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(interval);
      try {
        unsubscribe();
      } catch {
      }
      try {
        dispose?.();
      } catch {
      }
      dispose = void 0;
    };
  }, `${pluginName}: composer gate`);
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
var PROMPT = "Reply with exactly: OK. Do not use any tools.";
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
  for (const selector of ["[data-composer-input]", "[contenteditable]", '[role="textbox"]', "textarea"]) {
    const found = document.querySelector(selector);
    if (found !== null) return found;
  }
  return void 0;
}
function describeComposer(element) {
  if (element === void 0) return null;
  return {
    tag: element.tagName,
    cls: String(element.className).slice(0, 60),
    contentEditable: element.getAttribute("contenteditable"),
    disabled: element.getAttribute("aria-disabled") ?? element.disabled ?? null,
    text: (element.textContent ?? "").slice(0, 60)
  };
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
function pressEnter(element) {
  try {
    element.focus();
    const options = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const down = new KeyboardEvent("keydown", options);
    element.dispatchEvent(down);
    element.dispatchEvent(new KeyboardEvent("keyup", options));
    return true;
  } catch {
    return false;
  }
}
function sidebarSections() {
  try {
    return document.querySelectorAll('[role="tree"] > div').length;
  } catch {
    return -1;
  }
}
function ungrouplessRows() {
  try {
    for (const section of document.querySelectorAll('[role="tree"] > div')) {
      if (section.querySelector('[data-row-key="workspace:"]') === null) continue;
      return section.querySelectorAll('[data-row-key^="session:"]').length;
    }
  } catch {
  }
  return -1;
}
function domProbe() {
  const count = (selector) => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return -1;
    }
  };
  let center = null;
  try {
    const column = document.querySelector('[class*="centerCol"]');
    center = column?.firstElementChild === null || column === null ? null : String(column.firstElementChild?.className ?? "").slice(0, 90);
  } catch {
  }
  let boundSession = null;
  try {
    boundSession = document.querySelector("[data-conversation-content]")?.getAttribute("data-conversation-session") ?? null;
  } catch {
  }
  return {
    composerHosts: count("[data-composer-input]"),
    textboxes: count('[role="textbox"]'),
    editables: count("[contenteditable]"),
    textareas: count("textarea"),
    sections: sidebarSections(),
    center,
    boundSession
  };
}
function visibleAlert() {
  try {
    const alert = document.querySelector('[role="alert"]');
    const text = String(alert?.textContent ?? "").trim();
    return text === "" ? null : text.slice(0, 160);
  } catch {
    return null;
  }
}
async function runProjectlessSelftest(ctx, deps) {
  const mark = `DSH-PROJECTLESS-PROBE-${Date.now().toString(36)}`;
  const startedFrom = deps.currentSessionId();
  const result = { mark, startedFrom: startedFrom ?? null };
  let target;
  try {
    result.sectionsBefore = sidebarSections();
    result.root = await deps.root();
    target = await deps.startProjectlessSession();
    result.createdSession = target;
    await wait(1800);
    result.afterCreate = {
      current: deps.currentSessionId() ?? null,
      cwd: deps.cwdOf(target) ?? null,
      hasWorkspace: deps.hasWorkspace(target),
      blank: deps.blank(target) ?? null,
      sections: sidebarSections(),
      ungrouplessRows: ungrouplessRows(),
      dom: domProbe()
    };
    const second = await deps.startProjectlessSession();
    await wait(1200);
    result.reuse = {
      sessionId: String(second),
      sameSession: second === target,
      cwd: deps.cwdOf(second) ?? null,
      sections: sidebarSections(),
      ungrouplessRows: ungrouplessRows()
    };
    const composer = findComposer();
    result.composer = describeComposer(composer);
    if (composer !== void 0) {
      result.typed = typeInto(composer, PROMPT);
      await wait(900);
      result.draftAfterTyping = readDraft(target);
      if (startedFrom !== void 0) deps.openSession(startedFrom);
      await wait(1400);
      const third = await deps.startProjectlessSession();
      await wait(1400);
      const returnedComposer = findComposer();
      result.draftKept = {
        sameSession: third === target,
        draft: readDraft(target),
        composerText: composerText(returnedComposer).slice(0, 80),
        sections: sidebarSections()
      };
      const sendTarget = returnedComposer ?? findComposer();
      result.enterPressed = sendTarget === void 0 ? false : pressEnter(sendTarget);
      await wait(6e3);
      result.afterSend = {
        blank: deps.blank(target) ?? null,
        draft: readDraft(target),
        composerText: composerText(findComposer()).slice(0, 80),
        alert: visibleAlert()
      };
    }
    if (startedFrom !== void 0) deps.openSession(startedFrom);
    await wait(1600);
    result.afterLeaving = {
      current: deps.currentSessionId() ?? null,
      hasWorkspace: deps.hasWorkspace(target),
      blank: deps.blank(target) ?? null,
      draft: readDraft(target)
    };
    deps.openSession(target);
    await wait(1800);
    const returned = {
      current: deps.currentSessionId() ?? null,
      composer: describeComposer(findComposer()),
      composerText: composerText(findComposer()).slice(0, 120),
      draft: readDraft(target)
    };
    result.afterReturning = returned;
    result.restored = returned.draft === PROMPT;
  } catch (reason) {
    result.error = String(reason).slice(0, 300);
  } finally {
    if (startedFrom !== void 0) {
      try {
        deps.openSession(startedFrom);
      } catch {
      }
    }
    report(ctx, { phase: "projectless-selftest", ...result });
  }
}

// src/client/locales.ts
var PROJECTLESS_LOCALE_NS = "projectless";
var zh = {
  "picker.projectless": "\u65E0\u5DE5\u4F5C\u533A\u4F1A\u8BDD",
  "picker.addWorkspace": "\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026",
  "modal.createFailed": "\u65E0\u6CD5\u521B\u5EFA\u65E0\u5DE5\u4F5C\u533A\u4F1A\u8BDD",
  "modal.close": "\u77E5\u9053\u4E86",
  /**
   * The working directory every projectless Session shares is named after this
   * string, and DSH puts a directory's basename on the hero's workspace chip —
   * so this string is also what that chip reads. Wording matches DSH's own
   * `group.ungrouped` in `dsh-client-ui-workspace`.
   */
  "group.ungrouped": "\u672A\u5206\u7EC4"
};
var en = {
  "picker.projectless": "Session without workspace",
  "picker.addWorkspace": "Add workspace\u2026",
  "modal.createFailed": "Could not create session without workspace",
  "modal.close": "Got it",
  "group.ungrouped": "Ungrouped"
};
var projectlessLocales = {
  zh,
  en
};

// src/client/sidebar.ts
var SIDEBAR_SLOT = "sidebar.workspaces";
var TREE = '[role="tree"]:has([data-row-key="workspace:"])';
var CSS = [
  "/* dsh-projectless: keep Ungrouped above every workspace group. */",
  `${TREE}{display:flex;flex-direction:column}`,
  `${TREE}>*{flex:0 0 auto}`,
  `${TREE}>div:has([data-row-key="workspace:"]){order:-1}`
].join("\n");
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
function keepRecencyOrder(ctx, pluginName, write = true) {
  ctx.effect(() => {
    let view;
    let disposed = false;
    let disposers = [];
    let timers = [];
    let warned = false;
    const writtenAccounts = /* @__PURE__ */ new Set();
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
      let sessions;
      let workspaces;
      try {
        sessions = ctx.sessions.list.getSnapshot();
        workspaces = ctx.workspaces.list.getSnapshot();
      } catch {
        return;
      }
      if (sessions?.phase !== void 0 && sessions.phase !== "ready") return;
      if (workspaces?.phase !== void 0 && workspaces.phase !== "ready") return;
      if ((sessions?.ids ?? []).length === 0) return;
      const changed = {};
      for (const [account, order] of Object.entries(recencyOrders(ctx))) {
        const current = stored[account];
        if (!Array.isArray(current) || sameOrder(current, order)) continue;
        if (order.length === 0 && current.length > 0) continue;
        if (writtenAccounts.has(account)) continue;
        changed[account] = order;
      }
      if (Object.keys(changed).length > 0) {
        for (const account of Object.keys(changed)) writtenAccounts.add(account);
      }
      if (Object.keys(changed).length === 0) return;
      if (!write) {
        console.warn(`${pluginName}: order refresh suppressed (diagnostic), accounts=${Object.keys(changed).length}`);
        return;
      }
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
function installDefaultNewSession(ctx, pluginName, startProjectless, ready = () => true) {
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
      if (!ready()) {
        report(ctx, { phase: "startSession", mode: "fallback-gate-not-ready" });
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
var BUILD = 37;
var FORCE_SELFTEST = false;
var PROBE_ONLY = false;
var ENABLE_UI = true;
var ENABLE_ORDER = true;
var ENABLE_SESSION = true;
var ENABLE_ORDER_WRITE = true;
var TREE_ROW = '[data-row-key="workspace:"]';
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
  createProjectlessSession: createProjectlessSession2,
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
  const workspaceItems = (workspaceState.items ?? []).map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 16 }),
    disabled: busy
  }));
  const flowAvailable = useDirectoryFlow((occupied) => occupied);
  React2.useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false);
  }, [flowOpen, flowAvailable]);
  const footer = [
    {
      id: PROJECTLESS,
      label: t("picker.projectless"),
      icon: /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 16 }),
      disabled: busy
    },
    ...flowAvailable ? [
      { type: "separator", id: "projectless-separator" },
      {
        id: ADD_WORKSPACE,
        label: t("picker.addWorkspace"),
        icon: /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
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
        await createProjectlessSession2();
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
  return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(
    import_dsh_client_ui_primitives.Menu,
    {
      open,
      anchor: null,
      items: workspaceItems,
      footer,
      selectedId,
      onSelect: handleSelect,
      onClose,
      side: "bottom",
      portal: true,
      getAnchorRect
    }
  ), renderSlot(DIRECTORY_FLOW, directoryFlowOwner), /* @__PURE__ */ React2.createElement(
    import_dsh_client_ui_primitives.Modal,
    {
      open: modalError !== null,
      onClose: () => {
        setModalError(null);
      },
      closeLabel: t("modal.close"),
      title: t("modal.createFailed"),
      footer: /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", onClick: () => {
        setModalError(null);
      } }, t("modal.close"))
    },
    /* @__PURE__ */ React2.createElement("div", { className: "dsh-projectless-error", role: "alert" }, modalError)
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
async function selfCheck(ctx, phase, gate) {
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
  let sidebarSections2 = -1;
  let ungroupless = 0;
  try {
    sidebarSections2 = document.querySelectorAll('[role="tree"] > div').length;
    for (const section of document.querySelectorAll('[role="tree"] > div')) {
      if (section.querySelector(TREE_ROW) !== null) {
        ungroupless = section.querySelectorAll('[data-row-key^="session:"]').length;
      }
    }
  } catch {
  }
  const ui = ctx.uiWorkspace;
  let blankWithoutWorkspace = 0;
  let current = null;
  let currentHasWorkspace = false;
  try {
    const sessions = ctx.sessions.list.getSnapshot();
    const workspaces = ctx.workspaces.list.getSnapshot().items ?? [];
    current = currentSessionId(ctx) ?? null;
    currentHasWorkspace = current === null ? false : workspaceOfSession(workspaces, current) !== void 0;
    for (const id of sessions.ids ?? []) {
      if (sessions.byId[id]?.blank !== true) continue;
      if (workspaceOfSession(workspaces, id) === void 0) blankWithoutWorkspace += 1;
    }
  } catch {
  }
  return await report(ctx, {
    phase,
    plugin: `${PACKAGE_ID}@${VERSION}`,
    build: BUILD,
    url: String((typeof location === "undefined" ? void 0 : location.href) ?? ""),
    wrapperInstalled: typeof ui?.startSession === "function" && ui.startSession.__dshProjectless === true,
    composerChain: (() => {
      try {
        const entries = [...ctx.slots.entries("conversation.composer") ?? []];
        if (entries.length === 0) return "(none)";
        const nameOf = (component) => {
          if (typeof component === "function") return component.name ?? "fn";
          if (typeof component === "object" && component !== null) {
            const shape = component;
            return shape.displayName ?? shape.type?.name ?? "obj";
          }
          return typeof component;
        };
        return entries.map((entry) => {
          const options = entry.options;
          const hasInject = options?.inject !== void 0 ? "i" : "-";
          return `${nameOf(entry.component)}#${String(options?.priority ?? "-")}${hasInject}`;
        }).join(",");
      } catch (reason) {
        return `err:${String(reason).slice(0, 60)}`;
      }
    })(),
    composerGate: { borrowed: gate.borrowed, opened: gate.opened, rendered: gate.rendered, syncs: gate.syncs, entriesSeen: gate.entriesSeen, registered: gate.registered, lastError: gate.lastError, probe: gate.probe },
    orderBy,
    storedAccounts,
    sidebarSections: sidebarSections2,
    ungrouplessSessions: ungroupless,
    blankWithoutWorkspace,
    current,
    currentHasWorkspace
  });
}
function currentSessionId(ctx) {
  try {
    const sessions = ctx.sessions.list.getSnapshot();
    return (sessions.ids ?? []).find((id) => (sessions.byId[id]?.retainedBy?.mainView ?? 0) > 0);
  } catch {
    return void 0;
  }
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
  const ui = ctx.uiWorkspace;
  const rpc = ctx.connection.rpc;
  const gate = { opened: 0, borrowed: false, rendered: 0, syncs: 0, entriesSeen: -1, registered: false, lastError: null, probe: null };
  let rootPromise;
  const projectlessRoot = () => rootPromise ??= requestProjectlessRoot(rpc);
  const orphanSessions = /* @__PURE__ */ new Set();
  const liveOrphans = () => {
    const live = [];
    let sessions;
    let workspaces = [];
    try {
      sessions = ctx.sessions.list.getSnapshot();
      workspaces = ctx.workspaces.list.getSnapshot().items ?? [];
    } catch {
      return live;
    }
    for (const id of [...orphanSessions]) {
      const row = sessions.byId[id];
      if (row === void 0 || row.blank !== true || workspaceOfSession(workspaces, id) !== void 0) {
        orphanSessions.delete(id);
        continue;
      }
      live.push(id);
    }
    return live;
  };
  const groupLabel = () => {
    try {
      const label = ctx.locale.bind(PROJECTLESS_LOCALE_NS)("group.ungrouped");
      if (typeof label === "string" && label !== "") return label;
    } catch {
    }
    return "Ungrouped";
  };
  const hasWorkspace = (sessionId) => {
    try {
      return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== void 0;
    } catch {
      return true;
    }
  };
  const startProjectlessSession = async () => {
    const receipt = await createProjectlessSession({
      sessions: ctx.sessions,
      openSession: (sessionId) => {
        ui.openSession(sessionId);
      },
      ensureGroupDirectory: () => requestGroupDirectory(rpc, groupLabel()),
      listSessions: () => {
        const snapshot = ctx.sessions.list.getSnapshot();
        return {
          ids: snapshot.ids ?? [],
          isBlank: (id) => snapshot.byId[id]?.blank,
          cwdOf: (id) => snapshot.byId[id]?.cwd
        };
      },
      hasWorkspace
    });
    orphanSessions.add(receipt.sessionId);
    report(ctx, {
      phase: "created",
      sessionId: receipt.sessionId,
      cwd: receipt.cwd,
      reused: receipt.reused,
      label: groupLabel(),
      orphans: orphanSessions.size
    });
    return receipt.sessionId;
  };
  report(ctx, { phase: "probe-attached", build: BUILD, ui: ENABLE_UI, order: ENABLE_ORDER, session: ENABLE_SESSION });
  window.setTimeout(() => {
    void selfCheck(ctx, "probe", gate);
  }, 3e3);
  const ticker = window.setInterval(() => {
    void selfCheck(ctx, "tick", gate);
  }, 8e3);
  ctx.effect(() => () => {
    window.clearInterval(ticker);
  }, `${PACKAGE_ID}: probe ticker`);
  if (PROBE_ONLY) return;
  if (!ENABLE_UI && !ENABLE_ORDER && !ENABLE_SESSION) return;
  ctx.effect(installPickerCss, `${PACKAGE_ID}: picker styles`);
  if (ENABLE_UI) installStyles(ctx, PACKAGE_ID);
  ctx.effect(
    () => ctx.locale.register(PROJECTLESS_LOCALE_NS, projectlessLocales),
    `${PACKAGE_ID}: dictionaries`
  );
  if (ENABLE_ORDER) keepRecencyOrder(ctx, PACKAGE_ID, ENABLE_ORDER_WRITE);
  if (ENABLE_SESSION) installDefaultNewSession(ctx, PACKAGE_ID, startProjectlessSession, () => gate.registered);
  if (ENABLE_SESSION) installComposerGate(ctx, PACKAGE_ID, {
    liveOrphans,
    currentSessionId: () => currentSessionId(ctx),
    cwdOf: (sessionId) => {
      try {
        return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
      } catch {
        return void 0;
      }
    },
    hasWorkspace: (sessionId) => {
      try {
        return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== void 0;
      } catch {
        return true;
      }
    }
  }, gate);
  if (ENABLE_UI) {
    const directoryFlow = {
      getSnapshot: () => ctx.slots.entries(DIRECTORY_FLOW).length > 0,
      subscribe: (listener) => ctx.slots.subscribe(DIRECTORY_FLOW, listener)
    };
    const actions = () => ({
      createWorkspace: (input) => ctx.workspaces.create(input),
      hooks: { directoryFlow },
      createProjectlessSession: startProjectlessSession
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
  }
  window.setTimeout(() => {
    void selfCheck(ctx, "applied", gate).then((reply) => {
      if (!FORCE_SELFTEST && !(reply?.commands ?? []).includes("projectless-selftest")) return;
      void runProjectlessSelftest(ctx, {
        startProjectlessSession,
        openSession: (sessionId) => {
          ui.openSession(sessionId);
        },
        currentSessionId: () => currentSessionId(ctx),
        cwdOf: (sessionId) => {
          try {
            return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
          } catch {
            return void 0;
          }
        },
        hasWorkspace: (sessionId) => {
          try {
            return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== void 0;
          } catch {
            return true;
          }
        },
        blank: (sessionId) => {
          try {
            return ctx.sessions.list.getSnapshot().byId[sessionId]?.blank;
          } catch {
            return void 0;
          }
        },
        root: projectlessRoot
      });
    });
  }, 2500);
}
return module.exports; } });
//# sourceMappingURL=client.js.map

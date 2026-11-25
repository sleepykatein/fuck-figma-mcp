const MIN_W = 300;
const MIN_H = 260;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const toJson = (v) =>
  JSON.stringify(v === undefined ? null : v, (k, x) => {
    if (typeof x === "symbol") return String(x);
    if (x && typeof x === "object" && "id" in x && "type" in x && "parent" in x && "removed" in x) return { id: x.id, type: x.type, name: x.name };
    return x;
  });

const state = { paused: false, follow: false };
const watched = new Set();
let sink = null;

const onNodeChange = (e) => {
  if (!sink) return;
  for (const c of e.nodeChanges) {
    if (c.type === "CREATE") sink.created.add(c.id);
    else if (c.type === "DELETE") {
      if (!sink.created.delete(c.id)) sink.removed.add(c.id);
      sink.changed.delete(c.id);
    } else if (!sink.created.has(c.id)) sink.changed.add(c.id);
  }
};

const watchPage = (page) => {
  if (!page || watched.has(page.id)) return;
  try {
    page.on("nodechange", onNodeChange);
    watched.add(page.id);
  } catch (e) {}
};

watchPage(figma.currentPage);
figma.on("currentpagechange", () => watchPage(figma.currentPage));

const flush = () => new Promise((r) => setTimeout(r, 30));

async function rootsOf(ids) {
  const set = new Set(ids);
  const roots = [];
  for (const id of [...set].slice(0, 400)) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    if (node.parent && set.has(node.parent.id)) continue;
    roots.push(node);
  }
  return roots;
}

const pageOf = (node) => {
  let n = node;
  while (n && n.type !== "PAGE") n = n.parent;
  return n;
};

async function reveal(nodes, select) {
  const live = nodes.filter((n) => n && !n.removed);
  if (!live.length) return 0;
  const page = pageOf(live[0]);
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
  const here = live.filter((n) => pageOf(n) === figma.currentPage);
  if (select) figma.currentPage.selection = here.filter((n) => "visible" in n);
  figma.viewport.scrollAndZoomIntoView(here);
  return here.length;
}

const ui = (m) => figma.ui.postMessage(m);

function labelFor(m) {
  if (m.label) return String(m.label).slice(0, 140);
  if (m.type === "screenshot") return null;
  const first = (m.code || "").split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("const ") && !s.startsWith("await figma.loadFontAsync"));
  return first ? first.slice(0, 80) : "Run script";
}

async function runExec(m, step) {
  sink = { created: new Set(), changed: new Set(), removed: new Set() };
  watchPage(figma.currentPage);
  try {
    const result = await new AsyncFunction("figma", m.code)(figma);
    await flush();
    return { result: toJson(result) };
  } finally {
    figma.commitUndo();
    const s = sink;
    sink = null;
    step.created = [...s.created];
    step.changed = s.changed.size;
    step.removed = s.removed.size;
  }
}

async function runScreenshot(m, step) {
  const node = m.nodeId ? await figma.getNodeByIdAsync(m.nodeId) : figma.currentPage;
  if (!node) throw new Error("Node not found: " + m.nodeId);
  step.label = step.label || (node.type === "PAGE" ? "Looked at page " + node.name : "Looked at " + node.name);
  step.target = node.type === "PAGE" ? null : node.id;
  let scale = m.scale || 1;
  if (node.type !== "PAGE" && m.maxDimension) scale = Math.min(scale, m.maxDimension / Math.max(node.width, node.height));
  const png = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
  return { png };
}

async function handleBridge(m) {
  const kind = m.type === "screenshot" ? "look" : "run";
  const step = { id: m.id, kind, label: labelFor(m), code: kind === "run" ? String(m.code || "").slice(0, 20000) : null, at: Date.now() };

  if (state.paused) {
    ui({ type: "step", phase: "blocked", step: { ...step, label: step.label || "Take a screenshot" } });
    figma.ui.postMessage({ id: m.id, ok: false, error: "Paused by the user in Figma (fuck-figma-mcp plugin). Ask them to press Resume, then retry." });
    return;
  }

  ui({ type: "step", phase: "start", step: { ...step, label: step.label || "Taking a screenshot" } });
  const t0 = Date.now();
  try {
    const out = kind === "run" ? await runExec(m, step) : await runScreenshot(m, step);
    figma.ui.postMessage({ id: m.id, ok: true, ...out });
    step.ok = true;
  } catch (e) {
    step.ok = false;
    step.error = String(e);
    step.stack = e && e.stack ? String(e.stack) : "";
    figma.ui.postMessage({ id: m.id, ok: false, error: step.error + (step.stack ? "\n" + step.stack : "") });
  }
  step.ms = Date.now() - t0;

  let roots = [];
  if (step.created && step.created.length) roots = await rootsOf(step.created);
  step.focus = roots.length ? roots.map((n) => n.id) : step.target ? [step.target] : [];
  step.createdCount = step.created ? step.created.length : 0;
  delete step.created;
  ui({ type: "step", phase: "end", step });

  if (state.follow && roots.length) await reveal(roots, false).catch(() => {});
}

async function handleUi(m) {
  if (m.type === "pause") {
    state.paused = !!m.value;
    ui({ type: "state", ...state });
  } else if (m.type === "follow") {
    state.follow = !!m.value;
    figma.clientStorage.setAsync("follow", state.follow);
    ui({ type: "state", ...state });
  } else if (m.type === "focus") {
    const nodes = [];
    for (const id of m.ids || []) nodes.push(await figma.getNodeByIdAsync(id));
    const n = await reveal(nodes.filter(Boolean), true);
    ui({ type: "focused", key: m.key, count: n });
  } else if (m.type === "resize") {
    const w = Math.max(MIN_W, Math.round(m.width));
    const h = Math.max(MIN_H, Math.round(m.height));
    figma.ui.resize(w, h);
    if (m.done) figma.clientStorage.setAsync("size", { w, h });
  }
}

let queue = Promise.resolve();

figma.ui.onmessage = async (m) => {
  if (!m || !m.type) return;
  if (m.type === "exec" || m.type === "screenshot") {
    queue = queue.then(() => handleBridge(m)).catch(() => {});
    return queue;
  }
  return handleUi(m);
};

(async () => {
  const size = (await figma.clientStorage.getAsync("size")) || { w: 320, h: 420 };
  state.follow = !!(await figma.clientStorage.getAsync("follow"));
  figma.showUI(__html__, { width: Math.max(MIN_W, size.w), height: Math.max(MIN_H, size.h), title: "fuck-figma-mcp" });
  ui({ type: "state", ...state });
  ui({ type: "hello", fileName: figma.root.name, editorType: figma.editorType, fileKey: figma.fileKey || null });
})();

import { WebSocketServer, WebSocket } from "ws";

export const PORT = Number(process.env.FIGMA_BRIDGE_PORT || 3056);

export function startHub(port = PORT) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  const clients = new Map();
  const pending = new Map();
  let seq = 0;

  wss.on("connection", (ws) => {
    const client = { ws, info: {}, at: Date.now(), peer: false };
    clients.set(ws, client);
    ws.on("message", async (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.type === "hello") { client.info = m; client.at = Date.now(); return; }
      if (m.type === "peer-hello") { client.peer = true; return; }
      if (m.type === "relay") {
        try {
          const r = await send(m.msg, m.opts || {});
          ws.send(JSON.stringify({ type: "relay-res", rid: m.rid, ok: true, res: r }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "relay-res", rid: m.rid, ok: false, error: e.message }));
        }
        return;
      }
      if (m.type === "relay-files") {
        ws.send(JSON.stringify({ type: "relay-res", rid: m.rid, ok: true, res: files() }));
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m) : p.reject(new Error(m.error));
    });
    ws.on("close", () => clients.delete(ws));
  });

  const live = () => [...clients.values()].filter((c) => !c.peer && c.ws.readyState === 1);
  const files = () => live().map((c) => c.info);

  const pick = (file) => {
    const f = file && file.toLowerCase();
    return live()
      .filter((c) => !f || c.info.fileKey === file || (c.info.fileName || "").toLowerCase().includes(f))
      .sort((a, b) => b.at - a.at)[0];
  };

  async function waitClient(file, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const c = pick(file);
      if (c) return c;
      if (Date.now() >= end) {
        const open = live().map((c) => c.info.fileName).filter(Boolean);
        throw new Error(
          open.length
            ? `No plugin connected for "${file}". Connected files: ${open.join(", ")}`
            : "Figma Design Bridge plugin is not running. In Figma: Plugins → Development → Figma Design Bridge."
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function send(msg, { file, timeout = 120000, wait = 3000 } = {}) {
    const client = await waitClient(file, wait);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out after ${timeout} ms`)); }, timeout);
      pending.set(id, { resolve, reject, timer });
      client.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  const ready = new Promise((resolve, reject) => { wss.once("listening", resolve); wss.once("error", reject); });

  return { send, ready, files: async () => files(), alive: () => true, role: "hub", close: () => wss.close() };
}

export function connectPeer(port = PORT) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map();
  let rid = 0;
  let open = false;

  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.type !== "relay-res") return;
    const p = pending.get(m.rid);
    if (!p) return;
    pending.delete(m.rid);
    m.ok ? p.resolve(m.res) : p.reject(new Error(m.error));
  });
  ws.on("close", () => {
    open = false;
    for (const p of pending.values()) p.reject(new Error("Bridge hub went away"));
    pending.clear();
  });

  const call = (payload) => new Promise((resolve, reject) => {
    if (!open) return reject(new Error("Bridge hub is not connected"));
    const id = ++rid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, rid: id }));
  });

  const ready = new Promise((resolve, reject) => {
    ws.once("open", () => { open = true; ws.send(JSON.stringify({ type: "peer-hello" })); resolve(); });
    ws.once("error", reject);
  });

  return {
    send: (msg, opts = {}) => call({ type: "relay", msg, opts }),
    files: () => call({ type: "relay-files" }),
    alive: () => open,
    role: "peer",
    ready,
    close: () => ws.close(),
  };
}

export async function openBridge(port = PORT) {
  const hub = startHub(port);
  try {
    await hub.ready;
    return hub;
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e;
  }
  const peer = connectPeer(port);
  await peer.ready;
  return peer;
}

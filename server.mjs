import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openBridge } from "./bridge.mjs";

let hub = null;

async function getHub() {
  if (hub && hub.alive()) return hub;
  hub = null;
  try {
    hub = await openBridge();
  } catch (e) {
    throw new Error(`Cannot reach the bridge: ${e.message}`);
  }
  return hub;
}

getHub().catch(() => {});

const server = new McpServer(
  { name: "fuck-figma-mcp", version: "2.0.0" },
  {
    instructions:
      "Edits Figma design files (and FigJam) through a local plugin, with no rate limits. The user must have the file open in the Figma desktop app and run Plugins → Development → fuck-figma-mcp. figma_run executes real Plugin API JavaScript with top-level await; send data back with return. Give every figma_run a short `label` (what the step does, in English sentence case): the user watches it live in the plugin. Colors are 0–1. Load fonts before touching text (Inter styles: Regular, Medium, Semi Bold, Bold). Use figma.setCurrentPageAsync to switch pages. There is no figma.createAutoLayout or node.set: build layouts with figma.createFrame() plus layoutMode, itemSpacing, padding and layoutSizing*, and assign props directly or with Object.assign. Each figma_run is one undo step for the user. If a call says the plugin is paused, stop and ask the user to resume. Check the result with figma_screenshot.",
  }
);

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (e) => ({ content: [{ type: "text", text: String(e.message || e) }], isError: true });

server.registerTool(
  "figma_status",
  { description: "List the Figma files where the bridge plugin is currently running.", inputSchema: {} },
  async () => {
    try {
      const files = await (await getHub()).files();
      return text(files.length ? JSON.stringify(files, null, 2) : "No plugin connected.");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "figma_run",
  {
    description:
      "Run Figma Plugin API JavaScript inside the open file. The `figma` global is available, top-level await works, and the value you `return` comes back as JSON (nodes are reduced to {id,type,name}). Return the ids of everything you create or change.",
    inputSchema: {
      code: z.string().describe("Plugin API JavaScript body"),
      label: z.string().max(140).optional().describe("Short description of this step shown live to the user, e.g. \"Build pricing cards\""),
      file: z.string().optional().describe("File name substring or file key, when several files run the plugin"),
      timeoutMs: z.number().int().positive().optional(),
    },
  },
  async ({ code, label, file, timeoutMs }) => {
    try {
      const r = await (await getHub()).send({ type: "exec", code, label }, { file, timeout: timeoutMs });
      return text(r.result ?? "null");
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "figma_screenshot",
  {
    description: "Render a node (or the whole current page when nodeId is omitted) to PNG and return the image.",
    inputSchema: {
      nodeId: z.string().optional(),
      scale: z.number().positive().max(4).optional(),
      maxDimension: z.number().int().positive().optional().describe("Cap for the longest edge in px, default 1600"),
      file: z.string().optional(),
    },
  },
  async ({ nodeId, scale, maxDimension, file }) => {
    try {
      const r = await (await getHub()).send({ type: "screenshot", nodeId, scale, maxDimension: maxDimension ?? 1600 }, { file });
      return { content: [{ type: "image", data: r.png, mimeType: "image/png" }] };
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());

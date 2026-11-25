import { readFileSync, writeFileSync } from "node:fs";
import { openBridge } from "./bridge.mjs";

const [cmd, a, b, c] = process.argv.slice(2);
const wait = Number(process.env.FIGMA_WAIT || 30000);
const timeout = Number(process.env.FIGMA_TIMEOUT || 120000);
const hub = await openBridge();

try {
  if (cmd === "exec") {
    const r = await hub.send({ type: "exec", code: readFileSync(a, "utf8"), label: process.env.FIGMA_LABEL }, { file: b, wait, timeout });
    console.log(r.result);
  } else if (cmd === "shot") {
    const r = await hub.send({ type: "screenshot", nodeId: a === "-" ? undefined : a, maxDimension: Number(c) || 1600 }, { wait, timeout });
    writeFileSync(b, Buffer.from(r.png, "base64"));
    console.log(b);
  } else if (cmd === "status") {
    await new Promise((r) => setTimeout(r, 3000));
    console.log(JSON.stringify(await hub.files(), null, 2));
  } else {
    console.log("usage: run.mjs exec <code.js> [file] | shot <nodeId|-> <out.png> [maxDim] | status");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
hub.close();
process.exit();

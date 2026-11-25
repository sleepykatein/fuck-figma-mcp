import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "plugin");
const html = readFileSync(join(root, "src/ui.html"), "utf8").replace(/\{\{font:([\w-]+)\}\}/g, (_, name) =>
  readFileSync(join(root, "src/fonts", name + ".woff")).toString("base64")
);
writeFileSync(join(root, "ui.html"), html);
console.log(`plugin/ui.html ${(html.length / 1024).toFixed(0)} KB`);

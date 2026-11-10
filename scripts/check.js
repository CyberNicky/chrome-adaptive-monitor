import { readFile, access, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

async function checkJs(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await checkJs(path);
    else if (path.endsWith(".js"))
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  }
}
const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
if (manifest.manifest_version !== 3)
  throw new Error("É necessário Manifest V3.");
for (const file of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...Object.values(manifest.icons),
])
  await access(join("extension", file));
if (
  manifest.host_permissions ||
  manifest.permissions.some((p) =>
    /declarativeNetRequest|webRequestBlocking/.test(p),
  )
)
  throw new Error("Este protótipo deve apenas observar.");
await Promise.all(["extension", "demo", "scripts", "tests"].map(checkJs));
console.log("Manifesto, arquivos e sintaxe JavaScript válidos.");

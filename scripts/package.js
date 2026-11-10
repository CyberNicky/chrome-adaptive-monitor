import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await rm("dist/navega-extension.zip", { force: true });
execFileSync("zip", ["-qr", "../dist/navega-extension.zip", "."], {
  cwd: "extension",
  stdio: "inherit",
});
console.log(
  "Extensão empacotada em dist/navega-extension.zip. Extraia antes de carregar no Chrome.",
);

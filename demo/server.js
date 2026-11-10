import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

function image(size) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440" viewBox="0 0 720 440"><rect width="720" height="440" fill="#dcebdd"/><circle cx="530" cy="110" r="55" fill="#edc686"/><path d="M0 440 240 115 430 440ZM230 440 510 165 720 440" fill="#6a9580"/><path d="M0 440 240 115 430 440" fill="#3a6b59"/></svg>';
  return svg.replace(
    "</svg>",
    `<!--${"x".repeat(Math.max(0, size - Buffer.byteLength(svg) - 7))}--></svg>`,
  );
}

function audio() {
  const samples = 8000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 8000) * 2000),
      44 + i * 2,
    );
  return wav;
}

export function createDemoServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (type, body, status = 200, extra = {}) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        ...extra,
      });
      res.end(body);
    };
    try {
      if (url.pathname === "/" || url.pathname === "/frame")
        return send(
          "text/html; charset=utf-8",
          await readFile(
            new URL(
              url.pathname === "/" ? "./index.html" : "./frame.html",
              import.meta.url,
            ),
          ),
        );
      if (url.pathname === "/style.css" || url.pathname === "/app.js")
        return send(
          url.pathname.endsWith("css") ? "text/css" : "text/javascript",
          await readFile(new URL(`.${url.pathname}`, import.meta.url)),
        );
      if (url.pathname === "/image.svg")
        return send(
          "image/svg+xml",
          image(
            Math.min(
              300000,
              Math.max(1000, Number(url.searchParams.get("size")) || 24000),
            ),
          ),
        );
      if (url.pathname === "/cached.svg")
        return send("image/svg+xml", image(12000), 200, {
          "Cache-Control": "public, max-age=3600",
          "Content-Length": "12000",
        });
      if (url.pathname === "/audio.wav") return send("audio/wav", audio());
      if (url.pathname === "/video.webm")
        return send(
          "video/webm",
          await readFile(new URL("./video.webm", import.meta.url)),
        );
      if (url.pathname === "/api/data")
        return send(
          "application/json",
          JSON.stringify({
            source: "servidor local",
            values: Array.from({ length: 120 }, (_, i) => ({
              resource: i,
              note: "Exemplo de dados para uma requisição Fetch.",
            })),
          }),
        );
      if (url.pathname === "/api/compressed")
        return send(
          "application/json",
          gzipSync(
            JSON.stringify({ message: "Conteúdo comprimido. ".repeat(8000) }),
          ),
          200,
          { "Content-Encoding": "gzip" },
        );
      if (url.pathname === "/api/chunks") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        });
        res.write("a".repeat(4000));
        const timeout = setTimeout(() => res.end("b".repeat(4000)), 400);
        res.on("close", () => clearTimeout(timeout));
        return;
      }
      if (url.pathname === "/redirect")
        return send("text/plain", "", 302, { Location: "/api/data" });
      if (url.pathname === "/worker.js")
        return send(
          "text/javascript",
          "self.onmessage = async () => { await (await fetch('/api/data?worker=1')).text(); self.postMessage('ok'); };",
        );
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }
      return send(
        "application/json",
        '{"error":"Recurso não encontrado — falha proposital da demonstração."}',
        404,
      );
    } catch {
      return send("text/plain", "Erro no servidor de demonstração.", 500);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  const server = createDemoServer();
  server.on("error", (error) => {
    console.error(`Não foi possível iniciar a demo: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Demonstração disponível em http://127.0.0.1:${port}\nEncerre com Ctrl+C.`,
    ),
  );
}

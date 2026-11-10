import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

test("demo serve tamanhos controlados, compressão, cache, redirecionamento e falha", async () => {
  const server = createDemoServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const image = await fetch(`${base}/image.svg?size=24000`);
    assert.equal((await image.arrayBuffer()).byteLength, 24000);
    const cached = await fetch(`${base}/cached.svg`);
    assert.match(cached.headers.get("cache-control"), /max-age/);
    assert.equal((await cached.arrayBuffer()).byteLength, 12000);
    const compressed = await fetch(`${base}/api/compressed`);
    assert.equal(compressed.headers.get("content-encoding"), "gzip");
    assert.ok((await compressed.json()).message.length > 100000);
    assert.equal(
      (await fetch(`${base}/redirect`, { redirect: "manual" })).status,
      302,
    );
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const wav = await (await fetch(`${base}/audio.wav`)).arrayBuffer();
    assert.equal(Buffer.from(wav).toString("ascii", 0, 4), "RIFF");
    const video = await fetch(`${base}/video.webm`);
    assert.equal(video.status, 200);
    assert.equal(video.headers.get("content-type"), "video/webm");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

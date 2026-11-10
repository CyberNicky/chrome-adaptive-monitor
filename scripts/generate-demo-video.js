// Development utility. The resulting file is versioned; presenting the demo needs only Node.
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 260;
    canvas.height = 146;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks = [];
    const stopped = new Promise((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () =>
        resolve(
          Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
        );
    });
    recorder.start();
    for (let frame = 0; frame < 12; frame++) {
      ctx.fillStyle = "#dcebdd";
      ctx.fillRect(0, 0, 260, 146);
      ctx.fillStyle = "#167461";
      ctx.beginPath();
      ctx.arc(35 + frame * 16, 73, 20, 0, Math.PI * 2);
      ctx.fill();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    return stopped;
  });
  await writeFile(
    new URL("../demo/video.webm", import.meta.url),
    Buffer.from(bytes),
  );
  console.log(`Vídeo de demonstração gerado: ${bytes.length} bytes.`);
} finally {
  await browser.close();
}

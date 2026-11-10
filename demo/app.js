const $ = (id) => document.getElementById(id);
const result = (message) => {
  $("result").textContent = message;
};
fetch("/api/data")
  .then((r) => r.json())
  .catch(() => result("Não foi possível buscar os dados iniciais."));
let sequence = 0;
$("images").onclick = () => {
  for (const size of [24000, 80000, 160000]) {
    const img = new Image();
    img.alt = `Paisagem de ${size / 1000} kB`;
    img.src = `/image.svg?size=${size}&request=${++sequence}`;
    $("gallery").append(img);
  }
  result("Três imagens solicitadas. Filtre por Imagem no monitor.");
};
$("data").onclick = async () => {
  try {
    await Promise.all(
      ["/api/data", "/api/compressed", "/api/chunks", "/redirect"].map((url) =>
        fetch(url).then((r) => r.text()),
      ),
    );
    result(
      "Dados carregados. Compare a transferência da resposta comprimida com o tamanho do conteúdo.",
    );
  } catch {
    result("Falha ao buscar dados. Verifique o servidor local.");
  }
};
$("error").onclick = async () => {
  const response = await fetch("/api/not-found");
  await response.text();
  result(
    `Resposta HTTP ${response.status}. É uma falha proposital para a demonstração.`,
  );
};
$("cache").onclick = async () => {
  await fetch("/cached.svg").then((r) => r.text());
  await fetch("/cached.svg").then((r) => r.text());
  result(
    "Mesmo recurso solicitado duas vezes. O Chrome pode servir a segunda resposta do cache.",
  );
};
$("media").onclick = () => {
  $("audio").src = "/audio.wav";
  $("audio").preload = "auto";
  $("audio").load();
  $("video").src = "/video.webm";
  $("video").preload = "auto";
  $("video").load();
  result(
    "Áudio WAV e vídeo WebM locais solicitados. Não há reprodução automática.",
  );
};
$("contexts").onclick = () => {
  const frame = document.createElement("iframe");
  frame.title = "Contexto de demonstração";
  frame.src = `http://localhost:${location.port}/frame`;
  $("frames").append(frame);
  const worker = new Worker("/worker.js");
  worker.postMessage("load");
  worker.onmessage = () => worker.terminate();
  result(
    "Iframe e worker criados. As requisições aparecem conforme a instrumentação dos contextos fica disponível.",
  );
};

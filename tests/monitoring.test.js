import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  collectEvent,
  stopSession,
  MAX_REQUESTS,
} from "../extension/monitoring/request-collector.js";
import { aggregateMetrics } from "../extension/monitoring/metrics-aggregator.js";
import { sanitizeUrl } from "../extension/monitoring/consumption-estimator.js";
import { classifyResource } from "../extension/monitoring/resource-classifier.js";

function fixture() {
  const s = createSession(
    { id: 1, url: "https://example.com/?secret=123" },
    1000,
  );
  s.recording = true;
  const event = (method, params, source) =>
    collectEvent(s, `Network.${method}`, { requestId: "1", ...params }, source);
  const start = (params = {}, source) =>
    event(
      "requestWillBeSent",
      {
        request: {
          url: "https://example.com/photo?token=abc#secret",
          method: "GET",
        },
        type: "Image",
        timestamp: 1,
        wallTime: 1,
        ...params,
      },
      source,
    );
  return { s, event, start };
}

test("sanitiza URLs e ignora protocolos não HTTP(S)", () => {
  assert.equal(
    sanitizeUrl("https://user:pass@example.com/a?q=secret#fragment"),
    "https://example.com/a",
  );
  for (const url of [
    "data:text/plain,test",
    "file:///tmp/a",
    "bad-url",
    "blob:https://example.com/abc",
  ])
    assert.equal(sanitizeUrl(url), null);
});

test("classifica MIME de áudio/vídeo e preserva mídia sem subtipo", () => {
  assert.equal(classifyResource("Media", "audio/wav"), "audio");
  assert.equal(classifyResource("Fetch", "video/mp4"), "video");
  assert.equal(classifyResource("Media"), "media");
  assert.equal(classifyResource("XHR", "application/json"), "fetch");
});

test("substitui bytes parciais pelo total final sem duplicá-los", () => {
  const { s, event, start } = fixture();
  start();
  event("responseReceived", {
    response: { status: 200, mimeType: "image/png", encodedDataLength: 200 },
    type: "Image",
  });
  event("dataReceived", { dataLength: 5000, encodedDataLength: 1000 });
  event("dataReceived", { dataLength: 5000, encodedDataLength: 1000 });
  assert.equal(s.requests[0].transferredBytes, 2200);
  event("loadingFinished", { timestamp: 1.5, encodedDataLength: 2300 });
  const m = aggregateMetrics(s, 61000);
  assert.equal(m.transferredBytes, 2300);
  assert.equal(m.decodedBytes, 10000);
  assert.equal(m.bytesPerMinute, 2300);
  assert.equal(m.byType.image.bytes, 2300);
  assert.equal(s.requests[0].durationMs, 500);
  assert.equal(s.requests[0].url, "https://example.com/photo");
});

test("não converte tamanho desconhecido em zero; cache é zero de transferência", () => {
  const { s, event, start } = fixture();
  start();
  assert.equal(aggregateMetrics(s).unknownSizes, 1);
  event("requestServedFromCache");
  event("responseReceived", {
    response: {
      status: 200,
      fromDiskCache: true,
      mimeType: "image/png",
      encodedDataLength: 900,
    },
    type: "Image",
  });
  event("loadingFinished", { timestamp: 2, encodedDataLength: 900 });
  assert.equal(s.requests[0].transferredBytes, 0);
  assert.equal(aggregateMetrics(s).cached, 1);
});

test("redirecionamento gera duas linhas, sem sobrescrever a primeira", () => {
  const { s, event, start } = fixture();
  start();
  start({
    request: { url: "https://example.com/final", method: "GET" },
    timestamp: 1.1,
    redirectResponse: {
      status: 302,
      encodedDataLength: 150,
      mimeType: "text/html",
    },
  });
  event("loadingFinished", { timestamp: 1.3, encodedDataLength: 500 });
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[0].state, "redirect");
  assert.equal(s.requests[0].status, 302);
  assert.equal(aggregateMetrics(s).transferredBytes, 650);
});

test("isola IDs iguais em iframe e worker; falhas e HTTP 404 entram na métrica", () => {
  const { s, event, start } = fixture();
  start({}, "iframe");
  start({}, "worker");
  event(
    "loadingFailed",
    { timestamp: 2, errorText: "net::ERR_CONNECTION_RESET" },
    "iframe",
  );
  event(
    "responseReceived",
    { response: { status: 404, mimeType: "application/json" }, type: "Fetch" },
    "worker",
  );
  event("loadingFinished", { timestamp: 2, encodedDataLength: 80 }, "worker");
  assert.equal(s.requests[0].state, "failed");
  assert.equal(s.requests[1].state, "complete");
  assert.equal(aggregateMetrics(s).failures, 2);
});

test("correlaciona conclusão de navegação que mudou de contexto CDP", () => {
  const { s, event, start } = fixture();
  start({}, "root");
  event(
    "responseReceived",
    { response: { status: 200, mimeType: "text/html" }, type: "Document" },
    "iframe",
  );
  event(
    "loadingFinished",
    { timestamp: 1.5, encodedDataLength: 1234 },
    "iframe",
  );
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].state, "complete");
  assert.equal(s.requests[0].transferredBytes, 1234);
  assert.equal(aggregateMetrics(s).pending, 0);
});

test("encerramento marca requisições pendentes e congela o ritmo", () => {
  const { s, event, start } = fixture();
  start();
  event("dataReceived", { dataLength: 100, encodedDataLength: 80 });
  stopSession(s, "Teste", 61000);
  assert.equal(s.requests[0].state, "interrupted");
  assert.equal(s.recording, false);
  assert.equal(aggregateMetrics(s, 999999).bytesPerMinute, 80);
  assert.equal(start(), false);
  assert.equal(s.requests.length, 1);
});

test("limite explícito evita crescimento ilimitado sem perder atualizações em andamento", () => {
  const { s, event, start } = fixture();
  for (let i = 0; i < MAX_REQUESTS; i++) start({ requestId: String(i) });
  start({ requestId: "overflow" });
  assert.equal(s.requests.length, MAX_REQUESTS);
  assert.equal(s.ignored, 1);
  assert.match(s.notice, /Limite/);
  event("loadingFinished", {
    requestId: "0",
    timestamp: 2,
    encodedDataLength: 12,
  });
  assert.equal(s.requests[0].transferredBytes, 12);
});

import { classifyResource } from "./resource-classifier.js";
import { nonNegative, sanitizeUrl } from "./consumption-estimator.js";

export const MAX_REQUESTS = 3000;

export function createSession(tab, now = Date.now()) {
  return {
    schemaVersion: 1,
    tabId: tab.id,
    pageUrl: sanitizeUrl(tab.url),
    startedAt: now,
    stoppedAt: null,
    recording: false,
    notice: "",
    requests: [],
    active: {},
    ignored: 0,
    sequence: 0,
  };
}

function applyResponse(row, response, type) {
  row.status = response.status ?? null;
  row.mimeType = response.mimeType ?? "";
  row.type = classifyResource(type, row.mimeType);
  row.fromCache ||= Boolean(
    response.fromDiskCache || response.fromPrefetchCache,
  );
  row.fromServiceWorker = Boolean(response.fromServiceWorker);
  // Cached resources have zero network transfer; worker responses may hide upstream traffic.
  row.transferredBytes = row.fromCache
    ? 0
    : nonNegative(response.encodedDataLength);
  row.protocol = response.protocol ?? "";
}

function finish(row, timestamp, state) {
  row.state = state;
  row.durationMs = Math.max(0, (timestamp - row.startedTimestamp) * 1000);
}

// Sensor-independent reducer: also used by deterministic tests with CDP fixtures.
export function collectEvent(session, method, params, sourceId = "root") {
  if (!session.recording) return false;
  let key = `${sourceId}:${params.requestId}`;
  // A navigation may move a request from the parent target into an OOPIF target.
  // Adopt only an unambiguous ID; otherwise keep target isolation intact.
  if (method !== "Network.requestWillBeSent" && !session.active[key]) {
    const candidates = Object.keys(session.active).filter((k) =>
      k.endsWith(`:${params.requestId}`),
    );
    if (candidates.length === 1) key = candidates[0];
  }
  let row = session.requests.findLast((r) => r.id === session.active[key]);
  if (method === "Network.requestWillBeSent") {
    if (row && params.redirectResponse) {
      applyResponse(row, params.redirectResponse, row.resourceType);
      finish(row, params.timestamp, "redirect");
      delete session.active[key];
    }
    const url = sanitizeUrl(params.request.url);
    if (!url) return false;
    if (session.requests.length >= MAX_REQUESTS) {
      session.ignored += 1;
      session.notice = `Limite de ${MAX_REQUESTS} requisições atingido. Exporte e inicie uma nova sessão. Os totais cobrem apenas os registros retidos.`;
      return true;
    }
    row = {
      id: ++session.sequence,
      url,
      method: params.request.method,
      domain: new URL(url).hostname,
      resourceType: params.type ?? "Other",
      type: classifyResource(params.type),
      mimeType: "",
      status: null,
      startedAt: params.wallTime * 1000,
      startedTimestamp: params.timestamp,
      durationMs: null,
      state: "pending",
      transferredBytes: null,
      decodedBytes: null,
      fromCache: false,
      fromServiceWorker: false,
      error: "",
      protocol: "",
    };
    session.requests.push(row);
    session.active[key] = row.id;
    return true;
  }
  if (!row) return false;
  switch (method) {
    case "Network.responseReceived":
      applyResponse(row, params.response, params.type);
      break;
    case "Network.requestServedFromCache":
      row.fromCache = true;
      row.transferredBytes = 0;
      break;
    case "Network.dataReceived":
      row.decodedBytes =
        (row.decodedBytes ?? 0) + (nonNegative(params.dataLength) ?? 0);
      if (!row.fromCache)
        row.transferredBytes =
          (row.transferredBytes ?? 0) +
          (nonNegative(params.encodedDataLength) ?? 0);
      break;
    case "Network.loadingFinished":
      row.transferredBytes = row.fromCache
        ? 0
        : nonNegative(params.encodedDataLength);
      finish(row, params.timestamp, "complete");
      delete session.active[key];
      break;
    case "Network.loadingFailed":
      row.error = params.errorText ?? "Falha de rede";
      finish(row, params.timestamp, "failed");
      delete session.active[key];
      break;
    default:
      return false;
  }
  return true;
}

export function stopSession(session, notice = "", now = Date.now()) {
  session.recording = false;
  session.stoppedAt = now;
  session.notice = notice || session.notice;
  for (const row of session.requests) {
    if (row.state === "pending") {
      row.state = "interrupted";
      row.error = "Captura encerrada antes da conclusão";
    }
  }
  session.active = {};
}

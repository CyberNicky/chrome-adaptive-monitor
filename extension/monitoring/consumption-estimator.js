export function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Values reported by Chrome, never inferred from file extensions or Content-Length.
export function estimateConsumption(request) {
  return {
    transferredBytes: nonNegative(request.transferredBytes),
    decodedBytes: nonNegative(request.decodedBytes),
    source:
      request.state === "pending"
        ? "partial-cdp"
        : request.state === "complete"
          ? "cdp"
          : "partial-cdp",
    cached: Boolean(request.fromCache),
    serviceWorker: Boolean(request.fromServiceWorker),
  };
}

// Query strings, fragments and credentials never enter the session or exported file.
export function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

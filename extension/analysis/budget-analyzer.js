export function analyzeBudget(settings, consumedBytes) {
  const totalBytes = settings
    ? Math.round(settings.dataAmount * (settings.dataUnit === "GB" ? 1e9 : 1e6))
    : 0;
  const consumed = Math.max(0, consumedBytes);
  const economyBytes = Math.ceil(
    (totalBytes * (settings?.economyPercent ?? 70)) / 100,
  );
  const restrictedBytes = Math.ceil(
    (totalBytes * (settings?.restrictedPercent ?? 90)) / 100,
  );
  return {
    configured: totalBytes > 0,
    enabled: Boolean(settings?.adaptiveEnabled),
    totalBytes,
    consumedBytes: consumed,
    remainingBytes: Math.max(0, totalBytes - consumed),
    usedPercent: totalBytes ? (consumed / totalBytes) * 100 : 0,
    economyBytes,
    restrictedBytes,
    need:
      !totalBytes || !settings.adaptiveEnabled
        ? "none"
        : consumed >= restrictedBytes
          ? "restrict"
          : consumed >= economyBytes
            ? "save"
            : "none",
  };
}

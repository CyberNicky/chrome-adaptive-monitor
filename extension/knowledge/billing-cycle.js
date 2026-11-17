// Civil dates avoid treating a daylight-saving day as exactly 24 hours.
const DAY = 86400000;
export function localDate(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Informe uma data de início válida.");
  const [year, month, day] = value.split("-").map(Number);
  const ordinal = Date.UTC(year, month - 1, day) / DAY;
  if (
    year < 1970 ||
    year > 9998 ||
    new Date(ordinal * DAY).toISOString().slice(0, 10) !== value
  )
    throw new Error("Informe uma data de início válida.");
  return { year, month, day, ordinal };
}
const fromOrdinal = (ordinal) =>
  new Date(ordinal * DAY).toISOString().slice(0, 10);
const midnight = (value) => {
  const { year, month, day } = parseDate(value);
  return new Date(year, month - 1, day).getTime();
};
const monthlyDate = (anchor, offset) => {
  const first = new Date(Date.UTC(anchor.year, anchor.month - 1 + offset, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return fromOrdinal(
    Date.UTC(
      first.getUTCFullYear(),
      first.getUTCMonth(),
      Math.min(anchor.day, last),
    ) / DAY,
  );
};
export function getBillingCycle(settings, now = Date.now()) {
  const anchor = parseDate(settings.cycleStartDate);
  const today = localDate(now);
  const civilToday = parseDate(today);
  let startDate = settings.cycleStartDate;
  let endDate;
  if (settings.cycleType === "days") {
    const offset = Math.max(
      0,
      Math.floor((civilToday.ordinal - anchor.ordinal) / settings.cycleDays),
    );
    startDate = fromOrdinal(anchor.ordinal + offset * settings.cycleDays);
    endDate = fromOrdinal(anchor.ordinal + (offset + 1) * settings.cycleDays);
  } else {
    let offset = Math.max(
      0,
      (civilToday.year - anchor.year) * 12 + civilToday.month - anchor.month,
    );
    if (offset > 0 && monthlyDate(anchor, offset) > today) offset--;
    startDate = monthlyDate(anchor, offset);
    endDate = monthlyDate(anchor, offset + 1);
  }
  return {
    key: `${startDate}/${endDate}`,
    scheduleKey: `${settings.cycleStartDate}/${settings.cycleType}/${settings.cycleDays ?? ""}`,
    startDate,
    endDate,
    startsAt: midnight(startDate),
    endsAt: midnight(endDate),
    active: today >= startDate,
    durationDays: parseDate(endDate).ordinal - parseDate(startDate).ordinal,
    remainingDays: Math.max(
      0,
      parseDate(endDate).ordinal -
        Math.max(civilToday.ordinal, parseDate(startDate).ordinal),
    ),
  };
}

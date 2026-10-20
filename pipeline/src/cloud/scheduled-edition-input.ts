type ScheduleEvent = { scheduledTime?: unknown };

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1_000;

export function editionInputForScheduledTime(event: ScheduleEvent) {
  if (typeof event.scheduledTime !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(event.scheduledTime)) {
    throw new Error("Expected an ISO UTC scheduledTime from EventBridge Scheduler");
  }
  const end = new Date(event.scheduledTime);
  if (Number.isNaN(end.getTime())) {
    throw new Error("Invalid EventBridge Scheduler scheduledTime");
  }
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(end);
  const value = (type: string) => dateParts.find((part) => part.type === type)?.value;
  const editionId = `daily-${value("year")}-${value("month")}-${value("day")}`;
  return {
    editionId,
    windowStart: new Date(end.getTime() - DAY_MS).toISOString(),
    windowEnd: end.toISOString(),
    confirmPaidAnalysis: true,
    confirmLiveArticleFetch: true,
    confirmPaidArticleAnalysis: true,
    confirmPaidArtDirection: true,
    confirmUnattendedRun: true,
    confirmPaidPanorama: true,
    confirmPaidWorld: true,
    confirmPaidLandmarks: true,
    confirmPublish: true,
  };
}

export async function main(event: ScheduleEvent) {
  return editionInputForScheduledTime(event);
}

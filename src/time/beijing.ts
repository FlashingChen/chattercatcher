const BEIJING_TIME_ZONE = "Asia/Shanghai";

const BEIJING_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatOffsetTimeZone(date: Date): string {
  const parts = Object.fromEntries(
    BEIJING_DATE_TIME_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

export function formatBeijingTimeForPrompt(date: Date): string {
  return `${formatOffsetTimeZone(date)}（北京时间，UTC+8，Asia/Shanghai）`;
}

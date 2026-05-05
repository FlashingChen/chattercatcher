import { describe, expect, it } from "vitest";
import { getNextCronRun, isValidCronSchedule, matchesCronSchedule } from "../../src/cron/schedule.js";

function localParts(date: Date): [number, number, number, number, number] {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}

describe("cron schedule utility", () => {
  it("validates supported five-field cron syntax", () => {
    expect(isValidCronSchedule("0 9 * * *")).toBe(true);
    expect(isValidCronSchedule("*/15 * * * *")).toBe(true);
    expect(isValidCronSchedule("0,30 8 * * 1")).toBe(true);
    expect(isValidCronSchedule("0 24 * * *")).toBe(false);
    expect(isValidCronSchedule("*/0 * * * *")).toBe(false);
    expect(isValidCronSchedule("*/60 * * * *")).toBe(false);
    expect(isValidCronSchedule("0,60 * * * *")).toBe(false);
    expect(isValidCronSchedule("0 9 0 * *")).toBe(false);
    expect(isValidCronSchedule("0 9 32 * *")).toBe(false);
    expect(isValidCronSchedule("0 9 * 0 *")).toBe(false);
    expect(isValidCronSchedule("0 9 * 13 *")).toBe(false);
    expect(isValidCronSchedule("0 9 * * 7")).toBe(false);
    expect(isValidCronSchedule("0 9 * * 1,2")).toBe(false);
    expect(isValidCronSchedule("0 9 * * 1-5")).toBe(false);
    expect(isValidCronSchedule("0 */2 * * *")).toBe(false);
    expect(isValidCronSchedule("0 9 */2 * *")).toBe(false);
    expect(isValidCronSchedule("0 9 * */2 *")).toBe(false);
    expect(isValidCronSchedule("bad cron")).toBe(false);
    expect(isValidCronSchedule("0 9 * * * *")).toBe(false);
  });

  it("matches supported schedules against a date", () => {
    expect(matchesCronSchedule("0 9 * * *", new Date(2026, 4, 5, 9, 0, 0))).toBe(true);
    expect(matchesCronSchedule("0 9 * * *", new Date(2026, 4, 5, 9, 1, 0))).toBe(false);
    expect(matchesCronSchedule("*/10 * * * *", new Date(2026, 4, 5, 9, 20, 0))).toBe(true);
    expect(matchesCronSchedule("5,35 * * * *", new Date(2026, 4, 5, 9, 35, 0))).toBe(true);
    expect(matchesCronSchedule("5,35 * * * *", new Date(2026, 4, 5, 9, 36, 0))).toBe(false);
  });

  it("calculates the next matching minute after a reference time", () => {
    expect(localParts(getNextCronRun("0 9 * * *", new Date(2026, 4, 5, 8, 58, 30))!)).toEqual([
      2026, 5, 5, 9, 0,
    ]);
    expect(localParts(getNextCronRun("*/15 * * * *", new Date(2026, 4, 5, 9, 14, 59))!)).toEqual([
      2026, 5, 5, 9, 15,
    ]);
    expect(localParts(getNextCronRun("0 9 * * *", new Date(2026, 4, 5, 9, 0, 0))!)).toEqual([
      2026, 5, 6, 9, 0,
    ]);
  });

  it("returns null for invalid schedules", () => {
    expect(getNextCronRun("bad cron", new Date(2026, 4, 5, 9, 0, 0))).toBeNull();
    expect(matchesCronSchedule("bad cron", new Date(2026, 4, 5, 9, 0, 0))).toBe(false);
  });
});

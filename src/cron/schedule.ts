interface ParsedCronSchedule {
  minute: FieldMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

type FieldMatcher = (value: number) => boolean;

export function isValidCronSchedule(schedule: string): boolean {
  return parseCronSchedule(schedule) !== null;
}

export function matchesCronSchedule(schedule: string, date: Date): boolean {
  const parsed = parseCronSchedule(schedule);
  if (!parsed) {
    return false;
  }

  return matchesParsedSchedule(parsed, date);
}

export function getNextCronRun(schedule: string, after: Date): Date | null {
  const parsed = parseCronSchedule(schedule);
  if (!parsed) {
    return null;
  }

  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (matchesParsedSchedule(parsed, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function matchesParsedSchedule(schedule: ParsedCronSchedule, date: Date): boolean {
  return (
    schedule.minute(date.getMinutes()) &&
    schedule.hour(date.getHours()) &&
    schedule.dayOfMonth(date.getDate()) &&
    schedule.month(date.getMonth() + 1) &&
    schedule.dayOfWeek(date.getDay())
  );
}

function parseCronSchedule(schedule: string): ParsedCronSchedule | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const minute = parseMinuteField(fields[0]);
  const hour = parseExactOrWildcardField(fields[1], 0, 23);
  const dayOfMonth = parseExactOrWildcardField(fields[2], 1, 31);
  const month = parseExactOrWildcardField(fields[3], 1, 12);
  const dayOfWeek = parseExactOrWildcardField(fields[4], 0, 6);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null;
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function parseMinuteField(field: string): FieldMatcher | null {
  if (field === "*") {
    return () => true;
  }

  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isInteger(step) || step <= 0 || step > 59) {
      return null;
    }

    return (value) => value % step === 0;
  }

  if (field.includes(",")) {
    const values = field.split(",").map((part) => parseExactNumber(part, 0, 59));
    if (values.some((value) => value === null)) {
      return null;
    }

    const allowed = new Set(values as number[]);
    return (value) => allowed.has(value);
  }

  const exact = parseExactNumber(field, 0, 59);
  if (exact === null) {
    return null;
  }

  return (value) => value === exact;
}

function parseExactOrWildcardField(field: string, min: number, max: number): FieldMatcher | null {
  if (field === "*") {
    return () => true;
  }

  const exact = parseExactNumber(field, min, max);
  if (exact === null) {
    return null;
  }

  return (value) => value === exact;
}

function parseExactNumber(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) {
    return null;
  }

  const value = Number(field);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return value;
}

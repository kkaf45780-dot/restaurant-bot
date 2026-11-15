import type { DayKey, DaySchedule, Restaurant, ScheduleException } from '../types/restaurant.ts';

const DAY_ORDER: DayKey[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const DAY_LABELS_AR: Record<DayKey, string> = {
  saturday: 'السبت',
  sunday: 'الأحد',
  monday: 'الإثنين',
  tuesday: 'الثلاثاء',
  wednesday: 'الأربعاء',
  thursday: 'الخميس',
  friday: 'الجمعة',
};

export interface RestaurantHoursStatus {
  isOpen: boolean;
  statusLabel: string;
  reasonText: string;
  todayHoursText: string;
  closesAtText: string | null;
  nextOpenText: string | null;
  currentLocalDate: string;
  currentLocalTime: string;
}

function parseTimeToMinutes(timeStr: string): number {
  const [hStr, mStr] = (timeStr || '00:00').split(':');
  const h = Math.min(23, Math.max(0, Number(hStr) || 0));
  const m = Math.min(59, Math.max(0, Number(mStr) || 0));
  return h * 60 + m;
}

export function formatTimeArabic12h(timeStr: string): string {
  const [hStr, mStr] = (timeStr || '00:00').split(':');
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const period = h < 12 ? 'صباحاً' : h === 12 ? 'ظهراً' : h < 17 ? 'عصراً' : 'مساءً';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minPadded = String(m).padStart(2, '0');
  if (h === 0) return `12:${minPadded} منتصف الليل`;
  return `${hour12}:${minPadded} ${period}`;
}

function getZonedDateParts(now: Date, timeZone: string): {
  dateStr: string;
  timeStr: string;
  minutesOfDay: number;
  dayKey: DayKey;
  yesterdayDateStr: string;
  yesterdayDayKey: DayKey;
} {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });

    const parts = formatter.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    let hour = Number(get('hour'));
    if (hour === 24) hour = 0;
    const minute = Number(get('minute'));

    const weekdayMap: Record<string, DayKey> = {
      Sun: 'sunday',
      Mon: 'monday',
      Tue: 'tuesday',
      Wed: 'wednesday',
      Thu: 'thursday',
      Fri: 'friday',
      Sat: 'saturday',
    };

    const dayKey = weekdayMap[get('weekday')] ?? DAY_ORDER[now.getDay()];
    const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const yesterdayUtc = new Date(Date.UTC(year, month - 1, day) - 86400000);
    const yesterdayDateStr = yesterdayUtc.toISOString().slice(0, 10);
    const yesterdayIdx = (DAY_ORDER.indexOf(dayKey) + 6) % 7;

    return {
      dateStr,
      timeStr,
      minutesOfDay: hour * 60 + minute,
      dayKey,
      yesterdayDateStr,
      yesterdayDayKey: DAY_ORDER[yesterdayIdx],
    };
  } catch {
    // Fallback if an invalid timezone string is entered in settings
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const dayKey = DAY_ORDER[now.getDay()];
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayDateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const yesterdayIdx = (DAY_ORDER.indexOf(dayKey) + 6) % 7;

    return {
      dateStr,
      timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      minutesOfDay: hour * 60 + minute,
      dayKey,
      yesterdayDateStr,
      yesterdayDayKey: DAY_ORDER[yesterdayIdx],
    };
  }
}

function addDaysToIsoDate(dateStr: string, offsetDays: number): { dateStr: string; dayKey: DayKey } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return {
    dateStr: dt.toISOString().slice(0, 10),
    dayKey: DAY_ORDER[dt.getUTCDay()],
  };
}

interface EffectiveDayHours {
  isClosed: boolean;
  openTime: string;
  closeTime: string;
  exceptionLabel?: string;
}

function resolveDaySchedule(
  dateStr: string,
  dayKey: DayKey,
  weeklySchedule: DaySchedule[],
  exceptions: ScheduleException[]
): EffectiveDayHours {
  const exception = exceptions.find((e) => e.date === dateStr);
  if (exception) {
    return {
      isClosed: exception.isClosed,
      openTime: exception.openTime || '12:00',
      closeTime: exception.closeTime || '00:00',
      exceptionLabel: exception.label,
    };
  }

  const regular = weeklySchedule.find((s) => s.day === dayKey);
  if (!regular) {
    return { isClosed: true, openTime: '12:00', closeTime: '00:00' };
  }

  return {
    isClosed: regular.isClosed,
    openTime: regular.openTime,
    closeTime: regular.closeTime,
  };
}

export function evaluateRestaurantHours(
  restaurant: Restaurant,
  now: Date = new Date()
): RestaurantHoursStatus {
  const tz = restaurant.systemSettings.timezone || 'Africa/Cairo';
  const zoned = getZonedDateParts(now, tz);
  const todaySchedule = resolveDaySchedule(
    zoned.dateStr,
    zoned.dayKey,
    restaurant.weeklySchedule,
    restaurant.scheduleExceptions
  );
  const yesterdaySchedule = resolveDaySchedule(
    zoned.yesterdayDateStr,
    zoned.yesterdayDayKey,
    restaurant.weeklySchedule,
    restaurant.scheduleExceptions
  );

  const todayHoursText = todaySchedule.isClosed
    ? todaySchedule.exceptionLabel
      ? `مغلق (${todaySchedule.exceptionLabel})`
      : 'إجازة اليوم'
    : `من ${formatTimeArabic12h(todaySchedule.openTime)} إلى ${formatTimeArabic12h(todaySchedule.closeTime)}`;

  if (restaurant.manualStatus === 'force_open') {
    return {
      isOpen: true,
      statusLabel: 'مفتوح الآن',
      reasonText: 'تم فتح المطعم يدوياً من الإدارة',
      todayHoursText,
      closesAtText: todaySchedule.isClosed ? null : formatTimeArabic12h(todaySchedule.closeTime),
      nextOpenText: null,
      currentLocalDate: zoned.dateStr,
      currentLocalTime: zoned.timeStr,
    };
  }

  if (restaurant.manualStatus === 'force_closed') {
    const nextOpen = findNextOpening(zoned.dateStr, zoned.minutesOfDay, restaurant);
    return {
      isOpen: false,
      statusLabel: 'مغلق الآن',
      reasonText: 'المطعم مغلق مؤقتاً من الإدارة',
      todayHoursText,
      closesAtText: null,
      nextOpenText: nextOpen,
      currentLocalDate: zoned.dateStr,
      currentLocalTime: zoned.timeStr,
    };
  }

  // 1. Check if still open from yesterday's overnight shift
  if (!yesterdaySchedule.isClosed) {
    const yOpen = parseTimeToMinutes(yesterdaySchedule.openTime);
    const yClose = parseTimeToMinutes(yesterdaySchedule.closeTime);
    if (yClose <= yOpen && zoned.minutesOfDay < yClose) {
      return {
        isOpen: true,
        statusLabel: 'مفتوح الآن',
        reasonText: `مفتوح حتى الساعة ${formatTimeArabic12h(yesterdaySchedule.closeTime)}`,
        todayHoursText,
        closesAtText: formatTimeArabic12h(yesterdaySchedule.closeTime),
        nextOpenText: null,
        currentLocalDate: zoned.dateStr,
        currentLocalTime: zoned.timeStr,
      };
    }
  }

  // 2. Check today's regular/exception schedule
  if (!todaySchedule.isClosed) {
    const tOpen = parseTimeToMinutes(todaySchedule.openTime);
    const tClose = parseTimeToMinutes(todaySchedule.closeTime);
    const isOvernight = tClose <= tOpen;

    const currentlyInsideShift = isOvernight
      ? zoned.minutesOfDay >= tOpen
      : zoned.minutesOfDay >= tOpen && zoned.minutesOfDay < tClose;

    if (currentlyInsideShift) {
      return {
        isOpen: true,
        statusLabel: 'مفتوح الآن',
        reasonText: `مفتوح حتى الساعة ${formatTimeArabic12h(todaySchedule.closeTime)}`,
        todayHoursText,
        closesAtText: formatTimeArabic12h(todaySchedule.closeTime),
        nextOpenText: null,
        currentLocalDate: zoned.dateStr,
        currentLocalTime: zoned.timeStr,
      };
    }
  }

  // 3. Closed right now -> calculate exact next opening time
  const nextOpenText = findNextOpening(zoned.dateStr, zoned.minutesOfDay, restaurant);
  return {
    isOpen: false,
    statusLabel: 'مغلق الآن',
    reasonText: nextOpenText ? `نفتح ${nextOpenText}` : 'المطعم مغلق حالياً',
    todayHoursText,
    closesAtText: null,
    nextOpenText,
    currentLocalDate: zoned.dateStr,
    currentLocalTime: zoned.timeStr,
  };
}

function findNextOpening(
  currentDateStr: string,
  currentMinutes: number,
  restaurant: Restaurant
): string | null {
  for (let offset = 0; offset <= 7; offset++) {
    const target = addDaysToIsoDate(currentDateStr, offset);
    const sched = resolveDaySchedule(
      target.dateStr,
      target.dayKey,
      restaurant.weeklySchedule,
      restaurant.scheduleExceptions
    );
    if (sched.isClosed) continue;

    const openMin = parseTimeToMinutes(sched.openTime);
    if (offset === 0 && currentMinutes < openMin) {
      return `اليوم الساعة ${formatTimeArabic12h(sched.openTime)}`;
    }
    if (offset === 1) {
      return `غداً (${DAY_LABELS_AR[target.dayKey]}) الساعة ${formatTimeArabic12h(sched.openTime)}`;
    }
    if (offset > 1) {
      return `يوم ${DAY_LABELS_AR[target.dayKey]} الساعة ${formatTimeArabic12h(sched.openTime)}`;
    }
  }
  return null;
}

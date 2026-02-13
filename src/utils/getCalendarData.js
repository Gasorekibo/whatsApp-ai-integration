import { google } from 'googleapis';
import { DateTime } from 'luxon';
import oauth2Client from './auth.js';
import logger from '../logger/logger.js';

export default async function getCalendarData(email, refreshToken, days = 7) {
  try {
    const localAuth = new oauth2Client.constructor(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    localAuth.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: localAuth });

    const now = DateTime.now().setZone('Africa/Kigali');
    const timeMin = now.toISO();
    const timeMax = now.plus({ days }).toISO();


    const { data: freebusyData } = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: email }],
      },
    });

    const busy = freebusyData.calendars[email]?.busy || [];

    // Get actual events for more context
    const { data: eventsData } = await calendar.events.list({
      calendarId: email,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsData.items || [];


    const free = [];
    for (let day = 0; day < days; day++) {
      const currentDay = now.startOf('day').plus({ days: day });
      if (currentDay.weekday > 5) continue;

      const dayStart = currentDay.set({ hour: 9, minute: 0 });
      const dayEnd = currentDay.set({ hour: 17, minute: 0 });

      let cursor = dayStart;

      while (cursor < dayEnd) {
        const slotEnd = cursor.plus({ hours: 1 });

        if (slotEnd <= now) {
          cursor = slotEnd;
          continue;
        }

        const overlaps = busy.some((b) => {
          const bStart = DateTime.fromISO(b.start).setZone('Africa/Kigali');
          const bEnd = DateTime.fromISO(b.end).setZone('Africa/Kigali');
          return cursor < bEnd && slotEnd > bStart;
        });

        if (!overlaps) {
          free.push({
            start: cursor.toISO(),
            end: slotEnd.toISO(),
            formatted: cursor.toFormat('EEEE, MMMM d, yyyy – h:mm a'),
            day: cursor.toFormat('EEEE'),
            date: cursor.toFormat('MMMM d'),
            time: cursor.toFormat('h:mm a'),
          });
        }

        cursor = slotEnd;
      }
    }

    // Format busy slots
    const busyFormatted = busy.map(b => {
      const start = DateTime.fromISO(b.start).setZone('Africa/Kigali');
      const end = DateTime.fromISO(b.end).setZone('Africa/Kigali');
      return {
        start: start.toISO(),
        end: end.toISO(),
        formatted: `${start.toFormat('EEEE, MMMM d, yyyy – h:mm a')} to ${end.toFormat('h:mm a')}`,
        day: start.toFormat('EEEE'),
        date: start.toFormat('MMMM d'),
        timeRange: `${start.toFormat('h:mm a')} - ${end.toFormat('h:mm a')}`,
      };
    });

    // Format events
    const eventsFormatted = events.map(e => {
      const start = e.start.dateTime
        ? DateTime.fromISO(e.start.dateTime).setZone('Africa/Kigali')
        : DateTime.fromISO(e.start.date).setZone('Africa/Kigali');
      const end = e.end.dateTime
        ? DateTime.fromISO(e.end.dateTime).setZone('Africa/Kigali')
        : DateTime.fromISO(e.end.date).setZone('Africa/Kigali');

      return {
        summary: e.summary || 'Busy',
        start: start.toISO(),
        end: end.toISO(),
        formatted: `${start.toFormat('EEEE, MMMM d – h:mm a')} to ${end.toFormat('h:mm a')}`,
        isAllDay: !e.start.dateTime,
      };
    });

    return {
      employee: { email, timezone: 'Africa/Kigali' },
      period: { start: timeMin, end: timeMax, days, currentTime: now.toFormat('EEEE, MMMM d, yyyy – h:mm a') },
      busySlots: busyFormatted,
      events: eventsFormatted,
      freeSlots: free,
      workingHours: { start: '9:00 AM', end: '5:00 PM', timezone: 'Africa/Kigali (CAT)' },
    };
  } catch (error) {
    logger.error('getCalendarData error', { error: error.message });
    throw new Error(`Calendar fetch failed: ${error.message}`);
  }
};
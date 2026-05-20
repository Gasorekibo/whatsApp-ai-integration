import { DateTime } from 'luxon';
import getCalendarData from '../../../utils/getCalendarData.js';
import { bookingService } from '../../../services/booking.service.js';
import dbConfig from '../../../models/index.js';
import { sendWhatsAppInteractiveList } from '../sendWhatsAppInteractiveList.js';
import logger from '../../../logger/logger.js';
import { redisGet, redisSet, redisDel } from '../../../utils/redis.js';
import i18next from '../../../config/i18n.js';
import ragService from '../../../services/rag.service.js';

export const SLOT_PREFIX = 'slot:';
export const DAY_PREFIX  = 'day:';

const SLOTS_CACHE_TTL    = 10 * 60; // 10 minutes
const SERVICES_CACHE_TTL = 60 * 60; // 1 hour
const CAL_TZ             = 'Africa/Kigali';

function pushHistory(session, locale, userContent, modelContent) {
  session.history.push({ role: 'user',  content: userContent,  language: locale, timestamp: new Date() });
  session.history.push({ role: 'model', content: modelContent, language: locale, timestamp: new Date() });
  session.changed('history', true);
}

// ── Service helpers ───────────────────────────────────────────────────────────

async function getClientServices(clientId, namespace) {
  const key      = `services:${clientId}`;
  let   services = await redisGet(key);
  if (!services?.length) {
    services = await ragService.getServicesFromIndex(namespace).catch(() => []);
    if (services?.length) await redisSet(key, services, SERVICES_CACHE_TTL);
  }
  return services || [];
}

// Sends a numbered plain-text list (no interactive) so replies come back as
// regular text and are handled inside the booking flow (not the interactive handler).
async function sendServiceOptionsForBooking(from, send, services, introText) {
  let msg = introText + '\n\n';
  services.forEach((s, i) => { msg += `${i + 1}. ${s.name}\n`; });
  msg += '\nReply by *Copying* the service name you want to book.';
  await send(from, msg);
}

// Case-insensitive fuzzy match: exact first, then starts-with, then contains.
function matchService(services, input) {
  const q = input.toLowerCase().trim();
  return (
    services.find(s => s.name.toLowerCase() === q) ||
    services.find(s => s.name.toLowerCase().startsWith(q)) ||
    services.find(s => s.name.toLowerCase().includes(q)) ||
    services.find(s => q.includes(s.name.toLowerCase()))
  ) || null;
}

function daysKey(clientId, from)  { return `bdays:${clientId}:${from}`; }
function slotsKey(clientId, from) { return `bslots:${clientId}:${from}`; }

function initBooking(session, from) {
  return {
    bookingType:   'calendar',
    step:          'await_day',
    serviceName:   session.state.selectedServiceName || null,
    slotStart:     null,
    slotEnd:       null,
    slotFormatted: null,
    name:          session.name || null,
    email:         session.state.email || null,
    phone:         from,
  };
}

function initRestaurantBooking(session, from) {
  return {
    bookingType:     'restaurant',
    step:            'await_rest_date',
    name:            session.name || null,
    phone:           from,
    date:            null,
    time:            null,
    guests:          null,
    specialRequests: null,
  };
}

function initHotelBooking(session, from) {
  return {
    bookingType: 'hotel',
    step:        'await_hotel_checkin',
    name:        session.name || null,
    email:       session.state.email || null,
    phone:       from,
    checkIn:     null,
    checkOut:    null,
    roomType:    null,
    guests:      null,
  };
}

// ── Entry points ──────────────────────────────────────────────────────────────

export async function startRestaurantBookingFlow(from, client, session, locale, send, saveSession) {
  if (!session.state.booking) {
    session.state.booking = initRestaurantBooking(session, from);
  } else {
    session.state.booking.bookingType = 'restaurant';
    session.state.booking.step        = 'await_rest_date';
  }
  session.changed('state', true);
  await saveSession();
  await send(from,
    '🍽️ *Restaurant Table Reservation*\n\n' +
    '📅 What date would you like to reserve a table?\n' +
    '_(e.g. January 15, tomorrow, or 2024-01-15)_'
  );
}

export async function startHotelBookingFlow(from, client, session, locale, send, saveSession) {
  if (!session.state.booking) {
    session.state.booking = initHotelBooking(session, from);
  } else {
    session.state.booking.bookingType = 'hotel';
    session.state.booking.step        = 'await_hotel_checkin';
  }
  session.changed('state', true);
  await saveSession();
  await send(from,
    '🏨 *Hotel Room Reservation*\n\n' +
    '📅 What is your check-in date?\n' +
    '_(e.g. January 15 or 2024-01-15)_'
  );
}

export async function startBookingFlow(from, client, session, locale, send, saveSession) {
  if (!session.state.booking) {
    session.state.booking = initBooking(session, from);
    session.changed('state', true);
  }

  const b         = session.state.booking;
  const clientId  = client?.id;
  const namespace = client?.pineconeIndex || clientId || 'default';

  // Validate/normalise whatever service name we have (whether pre-filled by AI or set earlier)
  if (b.serviceName) {
    const services = await getClientServices(clientId, namespace);
    if (services.length > 0) {
      const matched = matchService(services, b.serviceName);
      if (matched) {
        b.serviceName = matched.name; // use canonical capitalisation
      } else {
        // Pre-filled name is not a real service — ask the user to choose
        b.serviceName = null;
      }
    }
  }

  if (!b.serviceName) {
    b.step = 'await_service';
    session.changed('state', true);
    await saveSession();

    const services = await getClientServices(clientId, namespace);
    if (services.length > 0) {
      await sendServiceOptionsForBooking(
        from, send, services,
        '📋 Which service would you like to book an appointment for?'
      );
    } else {
      await send(from,
        '📋 Which service would you like to book an appointment for?\n\n' +
        'Please type the service name.'
      );
    }
    return;
  }

  await showAvailableDays(from, client, session, locale, send, saveSession);
}

// ── Step 1: show available days for the next 7 calendar days ─────────────────

export async function showAvailableDays(from, client, session, locale, send, saveSession) {
  const clientId = client?.id;

  // Fetch employee calendar
  let employee;
  try {
    employee = await dbConfig.db.Employee.findOne({ where: { clientId } });
  } catch (err) {
    logger.error('showAvailableDays: DB error', { error: err.message });
  }

  if (!employee) {
    await send(from, 'Sorry, our booking calendar is not configured yet. Please contact us directly to schedule an appointment.');
    return;
  }

  const refreshToken = employee.getDecryptedToken();
  if (!refreshToken) {
    await send(from, 'Sorry, our calendar is temporarily unavailable. Please contact us directly.');
    return;
  }

  let calData;
  try {
    calData = await getCalendarData(employee.email, refreshToken, 7);
  } catch (err) {
    logger.error('showAvailableDays: getCalendarData failed', { error: err.message });
    await send(from, "Sorry, we couldn't load the calendar right now. Please try again shortly.");
    return;
  }

  // Group free slots by date key (e.g. "January 15")
  const grouped = {};
  for (const slot of calData.freeSlots || []) {
    if (!grouped[slot.date]) grouped[slot.date] = [];
    grouped[slot.date].push(slot);
  }

  // Walk 7 calendar days and classify each weekday
  const now         = DateTime.now().setZone(CAL_TZ);
  const availDays   = []; // days with open slots → shown as list rows
  const bookedDays  = []; // weekdays fully booked → mentioned in body

  for (let i = 0; i < 7; i++) {
    const d       = now.startOf('day').plus({ days: i });
    if (d.weekday > 5) continue; // skip Sat/Sun

    const dateKey  = d.toFormat('MMMM d');   // matches slot.date
    const dayLabel = d.toFormat('EEE, MMM d'); // e.g. "Mon, Jan 15"
    const slots    = grouped[dateKey] || [];

    if (slots.length > 0) {
      availDays.push({ label: dayLabel, dateKey, slots });
    } else {
      bookedDays.push(dayLabel);
    }
  }

  if (availDays.length === 0) {
    const bookedNote = bookedDays.length
      ? `\n\nFully booked this week: ${bookedDays.join(', ')}.`
      : '';
    await send(from,
      `😔 No available appointment slots in the next 7 days.${bookedNote}\n\n` +
      'Please contact us directly to arrange an appointment.'
    );
    return;
  }

  // Cache day list for lookup when user taps
  await redisSet(daysKey(clientId, from), availDays, SLOTS_CACHE_TTL);

  // Build interactive list rows (one row per available day)
  const rows = availDays.map((d, i) => ({
    id:          `${DAY_PREFIX}${i}`,
    title:       d.label.slice(0, 24),
    description: `${d.slots.length} slot${d.slots.length !== 1 ? 's' : ''} available`,
  }));

  const serviceName = session.state.booking?.serviceName || 'your appointment';

  // Compose body — include fully-booked days so user knows
  let body = `Select a day to book *${serviceName}*:`;
  if (bookedDays.length) {
    body += `\n\n_Fully booked: ${bookedDays.join(', ')}_`;
  }

  await sendWhatsAppInteractiveList(from, client, {
    header:   '📅 Choose a Day',
    body,
    button:   'Choose day',
    footer:   `Mon–Fri · ${calData.workingHours.start} – ${calData.workingHours.end}`,
    sections: [{ title: 'Available days', rows }],
  });

  session.state.booking.step = 'await_day';
  session.changed('state', true);
  await saveSession();
}

// ── Called when user taps a day row ──────────────────────────────────────────

export async function handleDaySelection(from, client, session, dayIndex, locale, send, saveSession) {
  const clientId = client?.id;
  const days     = await redisGet(daysKey(clientId, from));
  const day      = days?.[dayIndex];

  if (!day) {
    await send(from, "That day is no longer available. Let me refresh the calendar for you.");
    await showAvailableDays(from, client, session, locale, send, saveSession);
    return;
  }

  // Store chosen day's slots so slot:N lookups work
  await redisSet(slotsKey(clientId, from), day.slots, SLOTS_CACHE_TTL);

  // Build interactive list of time slots for this day
  const rows = day.slots.map((slot, i) => ({
    id:          `${SLOT_PREFIX}${i}`,
    title:       slot.time.slice(0, 24),
    description: `${slot.day}, ${slot.date} · 1 hour`,
  }));

  await sendWhatsAppInteractiveList(from, client, {
    header:   `📅 ${day.label}`,
    body:     `Choose your preferred time for *${session.state.booking?.serviceName || 'your appointment'}*:`,
    button:   'Choose time',
    footer:   'Each slot is 1 hour',
    sections: [{ title: 'Available times', rows }],
  });

  session.state.booking.step = 'await_slot';
  session.changed('state', true);
  await saveSession();
}

// ── Called when user taps a time slot row ─────────────────────────────────────

export async function handleSlotSelection(from, client, session, slotIndex, locale, send, saveSession) {
  const clientId = client?.id;
  const slots    = await redisGet(slotsKey(clientId, from));
  const slot     = slots?.[slotIndex];

  if (!slot) {
    await send(from, 'That slot is no longer available. Let me show you the available days again.');
    await showAvailableDays(from, client, session, locale, send, saveSession);
    return;
  }

  if (!slot.start || !slot.end) {
    logger.error('handleSlotSelection: slot missing start or end', { slot, clientId, from: `***${from.slice(-4)}` });
    await send(from, 'That slot has incomplete data. Please choose another time.');
    await showAvailableDays(from, client, session, locale, send, saveSession);
    return;
  }

  const b = session.state.booking;
  b.slotStart     = slot.start;
  b.slotEnd       = slot.end;
  b.slotFormatted = slot.formatted;
  session.changed('state', true);

  await promptNextField(from, session, locale, send, saveSession);
}

// ── Handles text messages while booking is active ────────────────────────────

export async function handleBookingTextReply(from, client, session, text, locale, send, saveSession) {
  const b = session.state.booking;
  if (!b) return false;

  const lower = text.toLowerCase().trim();

  // Universal cancel
  if (['no', 'cancel', 'stop', 'back', 'quit', 'oya', 'hapana', 'non', 'nein', 'reka', 'harakabura'].includes(lower)) {
    session.state.booking         = null;
    session.state.activeOrderType = null;
    session.state.activeIntent    = 'general';
    session.changed('state', true);
    await saveSession();
    const t = i18next.getFixedT(locale);
    await send(from, t('booking_cancelled') || '❌ Booking cancelled. How else can I help you?');
    return true;
  }

  switch (b.step) {
    case 'await_service': {
      if (text.trim().length < 2) {
        await send(from, "Please type the name of the service you'd like to book.");
        return true;
      }

      const clientId  = client?.id;
      const namespace = client?.pineconeIndex || clientId || 'default';
      const services  = await getClientServices(clientId, namespace);

      if (services.length === 0) {
        // No service list configured — accept whatever the user typed
        b.serviceName = text.trim();
        session.changed('state', true);
        await saveSession();
        await showAvailableDays(from, client, session, locale, send, saveSession);
        return true;
      }

      // Numeric selection from the list we showed earlier
      const numMatch = /^\s*(\d{1,2})\s*$/.exec(text.trim());
      if (numMatch) {
        const idx     = parseInt(numMatch[1], 10) - 1;
        const service = services[idx];
        if (service) {
          b.serviceName = service.name;
          session.changed('state', true);
          await saveSession();
          await showAvailableDays(from, client, session, locale, send, saveSession);
          return true;
        }
        await send(from, `Please reply with a number between 1 and ${services.length}.`);
        await sendServiceOptionsForBooking(from, send, services, 'Here are our available services:');
        return true;
      }

      // Text match — fuzzy name lookup
      const matched = matchService(services, text.trim());
      if (matched) {
        b.serviceName = matched.name;
        session.changed('state', true);
        await saveSession();
        await showAvailableDays(from, client, session, locale, send, saveSession);
        return true;
      }

      // No match — show the list again
      await send(from, `❌ We don't currently offer "*${text.trim()}*".`);
      await sendServiceOptionsForBooking(
        from, send, services,
        'Here are the services you can book an appointment for:'
      );
      return true;
    }

    case 'await_day':
    case 'await_slot': {
      // Remind user to tap the list instead of typing
      const prompt = b.step === 'await_day'
        ? 'Please tap one of the available days above to continue.'
        : 'Please tap one of the time slots above to select your preferred appointment time.';
      await send(from, prompt);
      return true;
    }

    case 'await_name': {
      if (text.trim().length < 2) {
        await send(from, 'Please enter your full name.');
        return true;
      }
      b.name = text.trim();
      session.changed('state', true);
      await saveSession();
      await promptNextField(from, session, locale, send, saveSession);
      return true;
    }

    case 'await_email': {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
        await send(from,
          "❌ That doesn't look like a valid email address.\n" +
          'Please enter a valid email (e.g. *name@example.com*).'
        );
        return true;
      }
      b.email = text.trim().toLowerCase();
      session.changed('state', true);
      await saveSession();
      await sendConfirmationSummary(from, session, locale, send, saveSession);
      return true;
    }

    case 'await_confirm': {
      const CONFIRM_YES = new Set(['yes', 'oui', 'yego', 'ndio', 'ndiyo', 'ja', 'confirm', 'ok', 'okay', 'neza', 'sawa', 'sure', 'si']);
      const CONFIRM_NO  = new Set(['no', 'non', 'oya', 'hapana', 'nein', 'cancel', 'stop', 'back']);
      // Match on the full message OR just the first meaningful word ("yes please", "yes!", "no thanks")
      const firstWord = lower.split(/[\s,!.?;:]+/)[0];
      if (CONFIRM_YES.has(lower) || CONFIRM_YES.has(firstWord)) {
        await finalizeBooking(from, client, session, locale, send, saveSession);
      } else if (CONFIRM_NO.has(lower) || CONFIRM_NO.has(firstWord)) {
        session.state.booking         = null;
        session.state.activeOrderType = null;
        session.state.activeIntent    = 'general';
        session.changed('state', true);
        await saveSession();
        const t_i = i18next.getFixedT(locale);
        await send(from, t_i('booking_cancelled') || '❌ Booking cancelled. How else can I help you?');
      } else {
        // Re-show summary so user knows what they're confirming
        await sendConfirmationSummary(from, session, locale, send, saveSession);
      }
      return true;
    }

    // ── Restaurant steps ──────────────────────────────────────────────────────

    case 'await_rest_date': {
      const dateText = text.trim();
      if (dateText.length < 2) {
        await send(from, '📅 Please enter a valid date (e.g. *January 15*, *tomorrow*, or *2024-01-15*).');
        return true;
      }
      b.date = dateText;
      b.step = 'await_rest_time';
      session.changed('state', true);
      await saveSession();
      await send(from, '🕐 What time would you like to arrive?\n_(e.g. 7:00 PM or 19:00)_');
      return true;
    }

    case 'await_rest_time': {
      const timeText = text.trim();
      if (timeText.length < 2) {
        await send(from, '🕐 Please enter a valid time (e.g. *7:00 PM* or *19:00*).');
        return true;
      }
      b.time = timeText;
      b.step = 'await_rest_guests';
      session.changed('state', true);
      await saveSession();
      await send(from, '👥 How many guests will be dining?');
      return true;
    }

    case 'await_rest_guests': {
      const guestN = parseInt(text.trim(), 10);
      if (!guestN || guestN < 1 || guestN > 100) {
        await send(from, '👥 Please enter a valid number of guests (e.g. *2*).');
        return true;
      }
      b.guests = guestN;
      if (!b.name) {
        b.step = 'await_rest_name';
        session.changed('state', true);
        await saveSession();
        await send(from, '👤 What name should the reservation be under?');
      } else {
        b.step = 'await_rest_special';
        session.changed('state', true);
        await saveSession();
        await send(from, '✏️ Any special requests?\n_(dietary needs, occasion, seating preference — reply *none* to skip)_');
      }
      return true;
    }

    case 'await_rest_name': {
      if (text.trim().length < 2) {
        await send(from, '👤 Please enter a valid name for the reservation.');
        return true;
      }
      b.name = text.trim();
      b.step = 'await_rest_special';
      session.changed('state', true);
      await saveSession();
      await send(from, '✏️ Any special requests?\n_(dietary needs, occasion, seating preference — reply *none* to skip)_');
      return true;
    }

    case 'await_rest_special': {
      const SKIP_WORDS = new Set(['none', 'no', 'oya', 'hapana', 'non', 'nein', 'nta', 'ntacyo', 'skip', 'n/a', '-']);
      b.specialRequests = SKIP_WORDS.has(lower) ? null : text.trim();
      session.changed('state', true);
      await saveSession();
      await sendConfirmationSummary(from, session, locale, send, saveSession);
      return true;
    }

    // ── Hotel steps ───────────────────────────────────────────────────────────

    case 'await_hotel_checkin': {
      const ci = text.trim();
      if (ci.length < 2) {
        await send(from, '📅 Please enter a valid check-in date (e.g. *January 15* or *2024-01-15*).');
        return true;
      }
      b.checkIn = ci;
      b.step    = 'await_hotel_checkout';
      session.changed('state', true);
      await saveSession();
      await send(from, '📅 What is your check-out date?');
      return true;
    }

    case 'await_hotel_checkout': {
      const co = text.trim();
      if (co.length < 2) {
        await send(from, '📅 Please enter a valid check-out date (e.g. *January 17* or *2024-01-17*).');
        return true;
      }
      b.checkOut = co;
      b.step     = 'await_hotel_room_type';
      session.changed('state', true);
      await saveSession();
      await send(from,
        '🛏️ What type of room would you like?\n\n' +
        '1. Standard\n' +
        '2. Deluxe\n' +
        '3. Suite\n\n' +
        'Reply with *1*, *2*, or *3*.'
      );
      return true;
    }

    case 'await_hotel_room_type': {
      const ROOM_MAP = { '1': 'Standard', '2': 'Deluxe', '3': 'Suite', 'standard': 'Standard', 'deluxe': 'Deluxe', 'suite': 'Suite' };
      const roomType = ROOM_MAP[lower] || ROOM_MAP[text.trim().toLowerCase()];
      if (!roomType) {
        await send(from, '🛏️ Please choose: reply *1* for Standard, *2* for Deluxe, or *3* for Suite.');
        return true;
      }
      b.roomType = roomType;
      b.step     = 'await_hotel_guests';
      session.changed('state', true);
      await saveSession();
      await send(from, '👥 How many guests will be staying?');
      return true;
    }

    case 'await_hotel_guests': {
      const hotelN = parseInt(text.trim(), 10);
      if (!hotelN || hotelN < 1 || hotelN > 50) {
        await send(from, '👥 Please enter a valid number of guests (e.g. *2*).');
        return true;
      }
      b.guests = hotelN;
      if (!b.name) {
        b.step = 'await_hotel_name';
        session.changed('state', true);
        await saveSession();
        await send(from, '👤 What is your full name for the booking?');
      } else if (!b.email) {
        b.step = 'await_hotel_email';
        session.changed('state', true);
        await saveSession();
        await send(from, "📧 What is your email address?\nWe'll send your booking confirmation there.");
      } else {
        session.changed('state', true);
        await saveSession();
        await sendConfirmationSummary(from, session, locale, send, saveSession);
      }
      return true;
    }

    case 'await_hotel_name': {
      if (text.trim().length < 2) {
        await send(from, '👤 Please enter your full name.');
        return true;
      }
      b.name = text.trim();
      if (!b.email) {
        b.step = 'await_hotel_email';
        session.changed('state', true);
        await saveSession();
        await send(from, "📧 What is your email address?\nWe'll send your booking confirmation there.");
      } else {
        session.changed('state', true);
        await saveSession();
        await sendConfirmationSummary(from, session, locale, send, saveSession);
      }
      return true;
    }

    case 'await_hotel_email': {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
        await send(from,
          "❌ That doesn't look like a valid email address.\n" +
          'Please enter a valid email (e.g. *name@example.com*).'
        );
        return true;
      }
      b.email = text.trim().toLowerCase();
      session.changed('state', true);
      await saveSession();
      await sendConfirmationSummary(from, session, locale, send, saveSession);
      return true;
    }

    default:
      return false;
  }
}

// ── Ask for the next missing piece of info ────────────────────────────────────

async function promptNextField(from, session, locale, send, saveSession) {
  const b = session.state.booking;

  if (!b.name) {
    b.step = 'await_name';
    session.changed('state', true);
    await saveSession();
    await send(from, '👤 What is your full name?');
    return;
  }

  if (!b.email) {
    b.step = 'await_email';
    session.changed('state', true);
    await saveSession();
    await send(from, "📧 What is your email address?\nWe'll send the appointment confirmation there.");
    return;
  }

  await sendConfirmationSummary(from, session, locale, send, saveSession);
}

// ── Confirmation summaries ────────────────────────────────────────────────────

async function sendCalendarConfirmationSummary(from, session, locale, send, saveSession) {
  const b = session.state.booking;

  const summary = [
    '📋 *Booking Summary*',
    '',
    `Service:    ${b.serviceName}`,
    `Date/Time:  ${b.slotFormatted}`,
    `Name:       ${b.name}`,
    `Email:      ${b.email}`,
    `Phone:      ${b.phone}`,
    '',
    'Reply *Yes* to confirm or *No* to cancel.',
  ].join('\n');

  b.step = 'await_confirm';
  session.changed('state', true);
  await saveSession();
  await send(from, summary);
}

async function sendRestaurantConfirmationSummary(from, session, locale, send, saveSession) {
  const b = session.state.booking;

  const lines = [
    '📋 *Reservation Summary*',
    '',
    '🍽️ Type:    Restaurant Table',
    `📅 Date:    ${b.date}`,
    `🕐 Time:    ${b.time}`,
    `👥 Guests:  ${b.guests}`,
    `👤 Name:    ${b.name}`,
    `📞 Phone:   ${b.phone}`,
  ];
  if (b.specialRequests) lines.push(`✏️ Notes:   ${b.specialRequests}`);
  lines.push('', 'Reply *Yes* to confirm or *No* to cancel.');

  b.step = 'await_confirm';
  session.changed('state', true);
  await saveSession();
  await send(from, lines.join('\n'));
}

async function sendHotelConfirmationSummary(from, session, locale, send, saveSession) {
  const b = session.state.booking;

  const lines = [
    '📋 *Reservation Summary*',
    '',
    '🏨 Type:      Hotel Room',
    `📅 Check-in:  ${b.checkIn}`,
    `📅 Check-out: ${b.checkOut}`,
    `🛏️ Room:      ${b.roomType}`,
    `👥 Guests:    ${b.guests}`,
    `👤 Name:      ${b.name}`,
    `📞 Phone:     ${b.phone}`,
  ];
  if (b.email) lines.push(`📧 Email:     ${b.email}`);
  lines.push('', 'Reply *Yes* to confirm or *No* to cancel.');

  b.step = 'await_confirm';
  session.changed('state', true);
  await saveSession();
  await send(from, lines.join('\n'));
}

async function sendConfirmationSummary(from, session, locale, send, saveSession) {
  const b = session.state.booking;
  if (b.bookingType === 'restaurant') return sendRestaurantConfirmationSummary(from, session, locale, send, saveSession);
  if (b.bookingType === 'hotel')      return sendHotelConfirmationSummary(from, session, locale, send, saveSession);
  return sendCalendarConfirmationSummary(from, session, locale, send, saveSession);
}

// ── Finalization dispatcher ───────────────────────────────────────────────────

async function finalizeBooking(from, client, session, locale, send, saveSession) {
  const b = session.state.booking;
  if (b.bookingType === 'restaurant') return finalizeRestaurantBooking(from, client, session, locale, send, saveSession);
  if (b.bookingType === 'hotel')      return finalizeHotelBooking(from, client, session, locale, send, saveSession);
  // calendar
  if (client?.requireDepositBeforeBooking) {
    await finalizeWithPayment(from, client, session, locale, send, saveSession);
  } else {
    await finalizeDirectly(from, client, session, locale, send, saveSession);
  }
}

// ── Restaurant finalization ───────────────────────────────────────────────────

async function finalizeRestaurantBooking(from, client, session, locale, send, saveSession) {
  const b        = session.state.booking;
  const clientId = client?.id;
  const t        = i18next.getFixedT(locale);

  try {
    await dbConfig.db.ServiceRequest.create({
      clientId,
      service:       'Restaurant Table',
      bookingType:   'restaurant',
      name:          b.name,
      phone:         b.phone,
      email:         null,
      details: [
        `Date: ${b.date}`,
        `Time: ${b.time}`,
        `Guests: ${b.guests}`,
        b.specialRequests ? `Special requests: ${b.specialRequests}` : null,
      ].filter(Boolean).join('\n'),
      timeline:      `${b.date} at ${b.time}`,
      participants:  b.guests,
      status:        'confirmed',
      paymentStatus: 'not_required',
    });
  } catch (err) {
    logger.error('finalizeRestaurantBooking: ServiceRequest.create failed', { error: err.message, clientId });
    session.state.booking         = null;
    session.state.activeOrderType = null;
    session.state.activeIntent    = 'general';
    session.changed('state', true);
    await saveSession();
    await send(from, t('rest_booking_failed') || '❌ Sorry, we could not complete your reservation. Please contact us directly.');
    return;
  }

  session.state.booking         = null;
  session.state.activeOrderType = null;
  session.state.activeIntent    = 'general';
  session.changed('state', true);
  await saveSession();

  const lines = [
    '✅ *Table Reserved!*',
    '',
    '🍽️ Restaurant Reservation',
    `📅 Date:    ${b.date}`,
    `🕐 Time:    ${b.time}`,
    `👥 Guests:  ${b.guests}`,
    `👤 Name:    ${b.name}`,
    `📞 Phone:   ${b.phone}`,
  ];
  if (b.specialRequests) lines.push(`✏️ Notes:   ${b.specialRequests}`);
  lines.push('', 'We look forward to seeing you! 😊');

  const confirmMsg = lines.join('\n');
  await send(from, confirmMsg);

  pushHistory(session, locale,
    `I'd like to reserve a table for ${b.guests} on ${b.date} at ${b.time} under ${b.name}.`,
    confirmMsg
  );
  await saveSession();
}

// ── Hotel finalization ────────────────────────────────────────────────────────

async function finalizeHotelBooking(from, client, session, locale, send, saveSession) {
  const b        = session.state.booking;
  const clientId = client?.id;
  const t        = i18next.getFixedT(locale);

  try {
    await dbConfig.db.ServiceRequest.create({
      clientId,
      service:       'Hotel Room',
      bookingType:   'hotel',
      name:          b.name,
      phone:         b.phone,
      email:         b.email || null,
      details: [
        `Check-in: ${b.checkIn}`,
        `Check-out: ${b.checkOut}`,
        `Room type: ${b.roomType}`,
        `Guests: ${b.guests}`,
      ].join('\n'),
      timeline:      `Check-in: ${b.checkIn}, Check-out: ${b.checkOut}`,
      participants:  b.guests,
      status:        'confirmed',
      paymentStatus: 'not_required',
    });
  } catch (err) {
    logger.error('finalizeHotelBooking: ServiceRequest.create failed', { error: err.message, clientId });
    session.state.booking         = null;
    session.state.activeOrderType = null;
    session.state.activeIntent    = 'general';
    session.changed('state', true);
    await saveSession();
    await send(from, t('hotel_booking_failed') || '❌ Sorry, we could not complete your reservation. Please contact us directly.');
    return;
  }

  session.state.booking         = null;
  session.state.activeOrderType = null;
  session.state.activeIntent    = 'general';
  session.changed('state', true);
  await saveSession();

  const lines = [
    '✅ *Room Reserved!*',
    '',
    '🏨 Hotel Room Reservation',
    `📅 Check-in:  ${b.checkIn}`,
    `📅 Check-out: ${b.checkOut}`,
    `🛏️ Room:      ${b.roomType}`,
    `👥 Guests:    ${b.guests}`,
    `👤 Name:      ${b.name}`,
    `📞 Phone:     ${b.phone}`,
  ];
  if (b.email) lines.push(`📧 Email:     ${b.email}`);
  lines.push('', 'We look forward to welcoming you! 😊');

  const confirmMsg = lines.join('\n');
  await send(from, confirmMsg);

  pushHistory(session, locale,
    `I'd like to book a ${b.roomType} room from ${b.checkIn} to ${b.checkOut} for ${b.guests} guest(s) under ${b.name}.`,
    confirmMsg
  );
  await saveSession();
}

// Path A — payment required first ─────────────────────────────────────────────

async function finalizeWithPayment(from, client, session, locale, send, saveSession) {
  const b          = session.state.booking;
  const clientId   = client?.id;
  const t          = i18next.getFixedT(locale);
  const depositAmt = client?.depositAmount || parseInt(process.env.DEPOSIT_AMOUNT, 10) || 5000;
  const currency   = client?.currency || 'RWF';
  const flwKey     = client?.getDecryptedFlutterwaveKey?.();
  const redirectUrl = client?.paymentRedirectUrl || process.env.FLW_PAYMENT_REDIRECT_URL || '';

  if (!flwKey) {
    logger.error('finalizeWithPayment: no Flutterwave key', { clientId });
    await send(from, "❌ Payment is required to confirm your booking, but our payment system isn't configured yet. Please contact us directly.");
    return;
  }

  await send(from, '⏳ Preparing your payment link...');

  const safePrefix = (client?.botName || 'deposit').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const tx_ref     = `${safePrefix}-${from.replace(/\+/g, '')}-${Date.now()}`;

  const bookingMeta = {
    service:   b.serviceName,
    name:      b.name,
    email:     b.email,
    phone:     b.phone,
    slotStart: b.slotStart,
    slotEnd:   b.slotEnd,
    title:     `${b.serviceName} – ${b.name}`,
    tx_ref,
  };

  // Persist ServiceRequest as pending_payment so the webhook can find it
  try {
    await dbConfig.db.ServiceRequest.create({
      clientId,
      service:       b.serviceName,
      name:          b.name,
      email:         b.email,
      phone:         b.phone,
      startTime:     b.slotStart,
      endTime:       b.slotEnd,
      txRef:         tx_ref,
      amount:        depositAmt,
      paymentStatus: 'pending',
      status:        'pending_payment',
    });
  } catch (err) {
    logger.error('finalizeWithPayment: ServiceRequest.create failed', { error: err.message });
  }

  // Initiate Flutterwave payment
  let paymentLink = null;
  try {
    const payRes = await fetch('https://api.flutterwave.com/v3/payments', {
      method:  'POST',
      headers: { Authorization: `Bearer ${flwKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        tx_ref,
        amount:          depositAmt,
        currency,
        redirect_url:    redirectUrl,
        customer:        { email: b.email, phone_number: from.replace('+', ''), name: b.name },
        customizations:  { title: `${client?.botName || 'Deposit'} – Appointment Deposit`, description: `Deposit for ${b.serviceName}` },
        meta:            { phone: from, booking_details: JSON.stringify(bookingMeta) },
      }),
    });
    const payData = await payRes.json();
    if (payData.status === 'success') paymentLink = payData.data?.link;
  } catch (err) {
    logger.error('finalizeWithPayment: Flutterwave API error', { error: err.message });
  }

  // Cleanup booking state regardless
  await Promise.all([
    redisDel(daysKey(clientId, from)),
    redisDel(slotsKey(clientId, from)),
  ]).catch(() => {});

  session.state.booking             = null;
  session.state.selectedService     = null;
  session.state.selectedServiceName = null;
  session.state.activeOrderType     = null;
  session.state.activeIntent        = 'general';
  session.changed('state', true);
  await saveSession();

  if (!paymentLink) {
    await send(from,
      t('booking_payment_failed') ||
      "❌ We couldn't generate your payment link right now. Please contact us directly to complete the booking."
    );
    return;
  }

  const lines = [
    '💳 *Payment Required*',
    '',
    `To confirm your appointment, please pay the deposit of *${depositAmt} ${currency}*:`,
    '',
    `📋 Service:   ${b.serviceName}`,
    `📅 Date/Time: ${b.slotFormatted}`,
    `👤 Name:      ${b.name}`,
    '',
    `🔗 *Pay here:* ${paymentLink}`,
    '',
    '_Your appointment will be confirmed automatically once payment is complete._',
  ];

  const payMsg = lines.join('\n');
  await send(from, payMsg);

  pushHistory(session, locale,
    `I'd like to book ${b.serviceName} on ${b.slotFormatted} for ${b.name} (${b.email}, ${b.phone}).`,
    payMsg
  );
  await saveSession();
}

// Path B — no payment required, book directly ─────────────────────────────────

async function finalizeDirectly(from, client, session, locale, send, saveSession) {
  const b        = session.state.booking;
  const clientId = client?.id;
  const t        = i18next.getFixedT(locale);

  await send(from, '⏳ Creating your appointment, please wait...');

  const result = await bookingService.bookMeeting({
    title:         `${b.serviceName} – ${b.name}`,
    start:         b.slotStart,
    end:           b.slotEnd,
    description:   `Booked via WhatsApp\nPatient: ${b.name}\nPhone: ${b.phone}\nEmail: ${b.email}`,
    attendeeEmail: b.email,
    clientId,
  });

  if (!result.success) {
    logger.error('finalizeDirectly: bookMeeting failed', { error: result.error, clientId });
    await send(from,
      t('booking_failed') ||
      "❌ Sorry, we couldn't create your appointment right now.\nPlease contact us directly or try again later."
    );
    return;
  }

  // Persist ServiceRequest
  try {
    await dbConfig.db.ServiceRequest.create({
      clientId,
      service:       b.serviceName,
      name:          b.name,
      email:         b.email,
      phone:         b.phone,
      startTime:     b.slotStart,
      endTime:       b.slotEnd,
      status:        'confirmed',
      paymentStatus: 'not_required',
    });
  } catch (err) {
    logger.error('finalizeDirectly: ServiceRequest.create failed', { error: err.message });
  }

  // Cleanup
  await Promise.all([
    redisDel(daysKey(clientId, from)),
    redisDel(slotsKey(clientId, from)),
  ]).catch(() => {});

  session.state.booking             = null;
  session.state.selectedService     = null;
  session.state.selectedServiceName = null;
  session.state.activeOrderType     = null;
  session.state.activeIntent        = 'general';
  session.changed('state', true);
  await saveSession();

  const lines = [
    '✅ *Appointment Confirmed!*',
    '',
    `📋 Service:    ${b.serviceName}`,
    `📅 Date/Time:  ${b.slotFormatted}`,
    `👤 Name:       ${b.name}`,
    `📧 Email:      ${b.email}`,
    `📞 Phone:      ${b.phone}`,
  ];

  if (result.meetLink) lines.push('', `🎥 *Google Meet:* ${result.meetLink}`);
  if (result.link)     lines.push(`📆 *Calendar:*     ${result.link}`);

  lines.push('', `A confirmation email has been sent to ${b.email}. See you soon! 😊`);

  const confirmMsg = lines.join('\n');
  await send(from, confirmMsg);

  pushHistory(session, locale,
    `I'd like to book ${b.serviceName} on ${b.slotFormatted} for ${b.name} (${b.email}, ${b.phone}).`,
    confirmMsg
  );
  await saveSession();
}

import { sendWhatsAppInteractiveList } from '../sendWhatsAppInteractiveList.js';
import logger from '../../../logger/logger.js';

export const ORDER_PREFIX        = 'order:';
export const BOOKING_TYPE_PREFIX = 'booktype:';
export const VALID_ORDER_TYPES   = ['booking', 'status'];
export const VALID_BOOKING_TYPES = ['calendar', 'restaurant', 'hotel'];

const LABELS = {
  en: {
    body:       'Thank you for choosing Order/Booking. Select an option below to get started.',
    button:     'Choose',
    section:    'Order options',
    booking:    { title: '📅 Book a reservation',   description: 'Appointments, tables & rooms' },
    status:     { title: '🔍 Check order status',   description: 'Track your booking or order' },
    bookingType: {
      body:       'What would you like to book?',
      button:     'Select',
      section:    'Booking type',
      calendar:   { title: '📅 Appointment',         description: 'Book a calendar appointment' },
      restaurant: { title: '🍽️ Restaurant table',    description: 'Reserve a table' },
      hotel:      { title: '🏨 Hotel room',           description: 'Reserve a room' },
    },
  },
  fr: {
    body:       'Merci d\'avoir choisi Commande/Réservation. Sélectionnez une option ci-dessous pour commencer.',
    button:     'Choisir',
    section:    'Options de commande',
    booking:    { title: '📅 Faire une réservation', description: 'Rendez-vous, tables & chambres' },
    status:     { title: '🔍 Vérifier le statut',    description: 'Suivre votre réservation' },
    bookingType: {
      body:       'Que souhaitez-vous réserver ?',
      button:     'Choisir',
      section:    'Type de réservation',
      calendar:   { title: '📅 Rendez-vous',          description: 'Réserver un créneau agenda' },
      restaurant: { title: '🍽️ Table restaurant',     description: 'Réserver une table' },
      hotel:      { title: '🏨 Chambre d\'hôtel',     description: 'Réserver une chambre' },
    },
  },
  rw: {
    body:       'Murakoze guhitamo Gutumiza/Kubika. Hitamo uburyo bumwe buri hasi utangire.',
    button:     'Hitamo',
    section:    'Amahitamo y\'iteka',
    booking:    { title: '📅 Fata gahunda',           description: 'Gahunda, ameza & inganda' },
    status:     { title: '🔍 Reba aho iteka ryageze', description: 'Kurikirana iteka ryawe' },
    bookingType: {
      body:       'Ni iki mushaka kubika?',
      button:     'Hitamo',
      section:    'Ubwoko bw\'ibikwa',
      calendar:   { title: '📅 Gahunda',              description: 'Fata gahunda y\'ibikorwa' },
      restaurant: { title: '🍽️ Ameza kwa resitora',   description: 'Bika itable kwa resitora' },
      hotel:      { title: '🏨 Inzu y\'akazi',         description: 'Bika icyumba cy\'hoteli' },
    },
  },
  sw: {
    body:       'Asante kwa kuchagua Oda/Uhifadhi. Chagua chaguo hapa chini ili kuanza.',
    button:     'Chagua',
    section:    'Chaguzi za agizo',
    booking:    { title: '📅 Fanya uhifadhi',         description: 'Miadi, meza & vyumba' },
    status:     { title: '🔍 Angalia hali ya agizo',  description: 'Fuatilia agizo lako' },
    bookingType: {
      body:       'Ungependa kuhifadhi nini?',
      button:     'Chagua',
      section:    'Aina ya uhifadhi',
      calendar:   { title: '📅 Miadi',                description: 'Weka miadi ya kalenda' },
      restaurant: { title: '🍽️ Meza ya mkahawa',      description: 'Hifadhi meza' },
      hotel:      { title: '🏨 Chumba cha hoteli',    description: 'Hifadhi chumba' },
    },
  },
  de: {
    body:       'Vielen Dank, dass Sie Bestellung/Buchung gewählt haben. Wählen Sie unten eine Option, um zu beginnen.',
    button:     'Wählen',
    section:    'Bestelloptionen',
    booking:    { title: '📅 Reservierung vornehmen', description: 'Termine, Tische & Zimmer' },
    status:     { title: '🔍 Bestellstatus prüfen',   description: 'Buchung verfolgen' },
    bookingType: {
      body:       'Was möchten Sie buchen?',
      button:     'Wählen',
      section:    'Buchungsart',
      calendar:   { title: '📅 Termin',               description: 'Kalendereintrag buchen' },
      restaurant: { title: '🍽️ Restauranttisch',      description: 'Tisch reservieren' },
      hotel:      { title: '🏨 Hotelzimmer',           description: 'Zimmer reservieren' },
    },
  },
};

// Placeholder messages for booking types not yet integrated
export const BOOKING_TYPE_PLACEHOLDERS = {
  restaurant: {
    en: '🍽️ *Restaurant table booking* is coming soon! For now, please contact us directly to reserve a table.',
    fr: '🍽️ La *réservation de table* arrive bientôt ! Pour l\'instant, veuillez nous contacter directement.',
    rw: '🍽️ *Kubika ameza kwa resitora* bizaza vuba! Ubu, tuganire kugira ngo tubike ameza.',
    sw: '🍽️ *Kuhifadhi meza ya mkahawa* kunakuja hivi karibuni! Kwa sasa, tafadhali wasiliana nasi moja kwa moja.',
    de: '🍽️ Die *Restauranttisch-Reservierung* kommt bald! Bitte kontaktieren Sie uns direkt, um einen Tisch zu reservieren.',
  },
  hotel: {
    en: '🏨 *Hotel room booking* is coming soon! For now, please contact us directly to reserve a room.',
    fr: '🏨 La *réservation de chambre d\'hôtel* arrive bientôt ! Pour l\'instant, veuillez nous contacter directement.',
    rw: '🏨 *Kubika icyumba cy\'hoteli* bizaza vuba! Ubu, tuganire kugira ngo tubike icyumba.',
    sw: '🏨 *Kuhifadhi chumba cha hoteli* kunakuja hivi karibuni! Kwa sasa, tafadhali wasiliana nasi moja kwa moja.',
    de: '🏨 Die *Hotelzimmer-Reservierung* kommt bald! Bitte kontaktieren Sie uns direkt, um ein Zimmer zu reservieren.',
  },
};

/**
 * Sends the order sub-menu (booking / status).
 */
export async function handleOrderRouting(to, client, language = 'en') {
  const l = LABELS[language] || LABELS.en;

  logger.whatsapp('info', 'Sending order sub-menu', { to: `***${String(to).slice(-4)}`, language });

  return sendWhatsAppInteractiveList(to, client, {
    header:   client?.botName || 'Order',
    body:     l.body,
    button:   l.button,
    sections: [{
      title: l.section,
      rows: [
        { id: `${ORDER_PREFIX}booking`, title: l.booking.title.slice(0, 24), description: l.booking.description.slice(0, 72) },
        { id: `${ORDER_PREFIX}status`,  title: l.status.title.slice(0, 24),  description: l.status.description.slice(0, 72) }
      ]
    }]
  });
}

/**
 * Sends the booking type sub-menu (calendar / restaurant / hotel).
 */
export async function handleBookingTypeRouting(to, client, language = 'en') {
  const l = (LABELS[language] || LABELS.en).bookingType;

  logger.whatsapp('info', 'Sending booking type sub-menu', { to: `***${String(to).slice(-4)}`, language });

  return sendWhatsAppInteractiveList(to, client, {
    header:   client?.botName || 'Booking',
    body:     l.body,
    button:   l.button,
    sections: [{
      title: l.section,
      rows: [
        { id: `${BOOKING_TYPE_PREFIX}calendar`,   title: l.calendar.title.slice(0, 24),   description: l.calendar.description.slice(0, 72) },
        { id: `${BOOKING_TYPE_PREFIX}restaurant`, title: l.restaurant.title.slice(0, 24), description: l.restaurant.description.slice(0, 72) },
        { id: `${BOOKING_TYPE_PREFIX}hotel`,      title: l.hotel.title.slice(0, 24),      description: l.hotel.description.slice(0, 72) },
      ]
    }]
  });
}

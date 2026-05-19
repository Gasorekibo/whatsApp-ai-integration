import { sendWhatsAppInteractiveList } from '../sendWhatsAppInteractiveList.js';
import logger from '../../../logger/logger.js';

export const ORDER_PREFIX      = 'order:';
export const VALID_ORDER_TYPES = ['booking', 'status'];

const LABELS = {
  en: {
    body:    'Thank you for choosing Order/Booking. Select an option below to get started.',
    button:  'Choose',
    section: 'Order options',
    booking: { title: '📅 Book an appointment', description: 'Schedule a consultation' },
    payment: { title: '💳 Make a payment',       description: 'Pay for a service' },
    status:  { title: '🔍 Check order status',   description: 'Track your booking or order' }
  },
  fr: {
    body:    'Merci d’avoir choisi Commande/Réservation. Sélectionnez une option ci-dessous pour commencer.',
    button:  'Choisir',
    section: 'Options de commande',
    booking: { title: '📅 Prendre rendez-vous',  description: 'Planifier une consultation' },
    payment: { title: '💳 Effectuer un paiement', description: 'Payer pour un service' },
    status:  { title: '🔍 Vérifier le statut',    description: 'Suivre votre réservation' }
  },
  rw: {
    body:    'Murakoze guhitamo Gutumiza/Kubika. Hitamo uburyo bumwe buri hasi utangire.',
    button:  'Hitamo',
    section: 'Amahitamo y\'iteka',
    booking: { title: '📅 Fata gahunda',           description: 'Tegura ikiganiro' },
    payment: { title: '💳 Ishyura',                description: 'Ishyura serivisi' },
    status:  { title: '🔍 Reba aho iteka ryageze', description: 'Kurikirana iteka ryawe' }
  },
  sw: {
    body:    'Asante kwa kuchagua Oda/Uhifadhi. Chagua chaguo hapa chini ili kuanza.',
    button:  'Chagua',
    section: 'Chaguzi za agizo',
    booking: { title: '📅 Weka miadi',           description: 'Panga mashauriano' },
    payment: { title: '💳 Fanya malipo',          description: 'Lipa huduma' },
    status:  { title: '🔍 Angalia hali ya agizo', description: 'Fuatilia agizo lako' }
  },
  de: {
    body:    'Vielen Dank, dass Sie Bestellung/Buchung gewählt haben. Wählen Sie unten eine Option, um zu beginnen.',
    button:  'Wählen',
    section: 'Bestelloptionen',
    booking: { title: '📅 Termin buchen',         description: 'Beratung planen' },
    payment: { title: '💳 Zahlung vornehmen',      description: 'Für einen Service bezahlen' },
    status:  { title: '🔍 Bestellstatus prüfen',   description: 'Buchung verfolgen' }
  }
};

/**
 * Sends the order sub-menu (booking / payment / status).
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

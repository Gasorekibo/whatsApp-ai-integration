import { sendWhatsAppInteractiveList } from './sendWhatsAppInteractiveList.js';
import logger from '../../logger/logger.js';

export const INTENT_PREFIX  = 'intent:';
export const VALID_INTENTS  = ['general', 'services', 'order', 'handoff'];

const LABELS = {
  en: {
    body:     'Please select one Category that best matches your needs:',
    button:   'Choose',
    section:  'Options',
    general:  { title: '💬 General inquiries',    description: 'Contact info, hours, location,...' },
    services: { title: '🛠️ Services & products',  description: 'Explore what we offer' },
    order:    { title: '📋 Order / Booking',       description: 'Book, pay or check status' },
    handoff:  { title: '🙋 Talk to a person',      description: 'Connect with our team' }
  },
  fr: {
    body:     'Veuillez sélectionner une catégorie qui correspond le mieux à vos besoins :',
    button:   'Choisir',
    section:  'Options',
    general:  { title: '💬 Renseignements',        description: 'Contact, horaires, localisation,...' },
    services: { title: '🛠️ Services et produits',  description: 'Découvrez nos offres' },
    order:    { title: '📋 Commande / Réservation', description: 'Réserver, payer ou vérifier' },
    handoff:  { title: '🙋 Parler à quelqu\'un',   description: 'Contacter notre équipe' }
  },
  rw: {
    body:     'Nyamuneka hitamo icyiciro kimwe gihuye neza n’ibyo ukeneye:',
    button:   'Hitamo',
    section:  'Amahitamo',
    general:  { title: '💬 Ibibazo rusange',        description: 'Telefoni, amasaha, aho tuba' },
    services: { title: '🛠️ Serivisi n\'ibicuruzwa', description: 'Reba ibyo dutanga' },
    order:    { title: '📋 Gutumiza / Gahunda',        description: 'Fata gahunda cyangwa ishyura' },
    handoff:  { title: '🙋 Vugana n\'umuntu',       description: 'Vugana n\'itsinda ryacu' }
  },
  sw: {
    body:     'Tafadhali chagua kundi moja linaloendana vyema na mahitaji yako:',
    button:   'Chagua',
    section:  'Chaguo',
    general:  { title: '💬 Maswali ya jumla',       description: 'Mawasiliano, saa, mahali' },
    services: { title: '🛠️ Huduma na bidhaa',       description: 'Chunguza tunachotoa' },
    order:    { title: '📋 Agizo / Miadi',           description: 'Weka miadi, lipa au angalia' },
    handoff:  { title: '🙋 Zungumza na mtu',         description: 'Unganishwa na timu yetu' }
  },
  de: {
    body:     'Bitte wählen Sie eine Kategorie aus, die Ihren Bedürfnissen am besten entspricht:',
    button:   'Wählen',
    section:  'Optionen',
    general:  { title: '💬 Allgemeine Anfragen',    description: 'Kontakt, Öffnungszeiten, Standort' },
    services: { title: '🛠️ Dienste & Produkte',     description: 'Unser Angebot entdecken' },
    order:    { title: '📋 Bestellung / Termin',     description: 'Buchen, zahlen oder Status prüfen' },
    handoff:  { title: '🙋 Mit einer Person sprechen', description: 'Unser Team kontaktieren' }
  }
};

export async function sendIntentList(to, client, language = 'en') {
  const l = LABELS[language] || LABELS.en;

  logger.whatsapp('info', 'Sending intent selection list', { to: `***${String(to).slice(-4)}`, language });

  return sendWhatsAppInteractiveList(to, client, {
    header:   client?.botName || 'Menu',
    body:     l.body,
    button:   l.button,
    sections: [{
      title: l.section,
      rows: [
        { id: `${INTENT_PREFIX}general`,  title: l.general.title.slice(0, 24),  description: l.general.description.slice(0, 72) },
        { id: `${INTENT_PREFIX}services`, title: l.services.title.slice(0, 24), description: l.services.description.slice(0, 72) },
        { id: `${INTENT_PREFIX}order`,    title: l.order.title.slice(0, 24),    description: l.order.description.slice(0, 72) },
        { id: `${INTENT_PREFIX}handoff`,  title: l.handoff.title.slice(0, 24),  description: l.handoff.description.slice(0, 72) }
      ]
    }]
  });
}

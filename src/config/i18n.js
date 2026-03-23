import i18next from 'i18next';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesPath = path.join(__dirname, '../locales');

const en = JSON.parse(fs.readFileSync(path.join(localesPath, 'en.json'), 'utf8'));
const fr = JSON.parse(fs.readFileSync(path.join(localesPath, 'fr.json'), 'utf8'));
const rw = JSON.parse(fs.readFileSync(path.join(localesPath, 'rw.json'), 'utf8'));
const de = JSON.parse(fs.readFileSync(path.join(localesPath, 'de.json'), 'utf8'));
const sw = JSON.parse(fs.readFileSync(path.join(localesPath, 'sw.json'), 'utf8'));

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    rw: { translation: rw },
    de: { translation: de },
    sw: { translation: sw }
  }
});

export default i18next;

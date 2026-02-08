import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import chatEn from './locales/en/chat.json' with { type: 'json' };
import commonEn from './locales/en/common.json' with { type: 'json' };
import settingsEn from './locales/en/settings.json' with { type: 'json' };
import skillsEn from './locales/en/skills.json' with { type: 'json' };
import chatKo from './locales/ko/chat.json' with { type: 'json' };
import commonKo from './locales/ko/common.json' with { type: 'json' };
import settingsKo from './locales/ko/settings.json' with { type: 'json' };
import skillsKo from './locales/ko/skills.json' with { type: 'json' };

const resources = {
  en: {
    common: commonEn,
    chat: chatEn,
    settings: settingsEn,
    skills: skillsEn,
  },
  ko: {
    common: commonKo,
    chat: chatKo,
    settings: settingsKo,
    skills: skillsKo,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'chat', 'settings', 'skills'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;

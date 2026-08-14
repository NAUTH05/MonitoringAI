import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import vi from "@/locales/vi.json";
import en from "@/locales/en.json";

const savedLang = typeof window !== "undefined" ? localStorage.getItem("app_lang") || "vi" : "vi";

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      vi: { translation: vi },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: "vi",
    interpolation: { escapeValue: false },
  });
}

i18n.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("app_lang", lng);
  }
});

export default i18n;

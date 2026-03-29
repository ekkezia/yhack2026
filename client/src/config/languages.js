export const LANGUAGE_OPTIONS = [
  {
    key: "english",
    label: "English",
    locale: "en-US",
    callerLocation: "United States",
  },
  {
    key: "indonesian",
    label: "Indonesian",
    locale: "id-ID",
    callerLocation: "Indonesia",
  },
  {
    key: "portuguese",
    label: "Portuguese",
    locale: "pt-BR",
    callerLocation: "Brazil",
  },
  {
    key: "spanish",
    label: "Spanish",
    locale: "es-ES",
    callerLocation: "Spain",
  },
  {
    key: "french",
    label: "French",
    locale: "fr-FR",
    callerLocation: "France",
  },
];

export function canonicalizeLanguage(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (
    raw.includes("indonesian") ||
    raw.includes("bahasa indonesia") ||
    raw === "bahasa"
  ) {
    return "indonesian";
  }

  if (raw.includes("portuguese") || raw.includes("português")) {
    return "portuguese";
  }

  if (raw.includes("spanish") || raw.includes("español")) {
    return "spanish";
  }

  if (raw.includes("french") || raw.includes("français")) {
    return "french";
  }

  if (raw.includes("english")) {
    return "english";
  }

  return raw;
}

export function getLanguageConfig(language) {
  const key = canonicalizeLanguage(language);
  return LANGUAGE_OPTIONS.find((item) => item.key === key) || null;
}

export function getLanguageLocale(language, fallback = "en-US") {
  return getLanguageConfig(language)?.locale || fallback;
}

export function getCallerLocation(language) {
  return getLanguageConfig(language)?.callerLocation || language || "Unknown";
}

export function getAvailableLanguageLabels() {
  return LANGUAGE_OPTIONS.map((item) => item.label);
}

export interface TranscriptionEntry {
  id: string;
  text: string;
  type: 'input' | 'output';
  timestamp: number;
}

export enum UserRole {
  SPEAKER = 'Speaker (Broadcast)',
  LISTENER = 'Listener (Translate)'
}

export enum PrebuiltVoice {
  KORE = 'Kore',
  PUCK = 'Puck',
  CHARON = 'Charon',
  FENRIR = 'Fenrir',
  ZEPHYR = 'Zephyr'
}

export enum SourceType {
  MIC = 'Microphone',
  SYSTEM = 'Internal Speaker',
  BOTH = 'Mic + Internal'
}

export enum SupportLanguage {
  AUTO = 'Auto Detect',
  // English
  ENGLISH_US = 'English (United States)',
  ENGLISH_UK = 'English (United Kingdom)',
  ENGLISH_AU = 'English (Australia)',
  ENGLISH_IN = 'English (India)',
  ENGLISH_CA = 'English (Canada)',
  // Spanish
  SPANISH_ES = 'Spanish (Spain)',
  SPANISH_MX = 'Spanish (Mexico)',
  SPANISH_US = 'Spanish (United States)',
  // French
  FRENCH_FR = 'French (France)',
  FRENCH_CA = 'French (Canada)',
  // Portuguese
  PORTUGUESE_BR = 'Portuguese (Brazil)',
  PORTUGUESE_PT = 'Portuguese (Portugal)',
  // Chinese
  CHINESE_SIMP = 'Chinese (Simplified)',
  CHINESE_TRAD = 'Chinese (Traditional)',
  CANTONESE = 'Cantonese (Hong Kong)',
  // Asian
  JAPANESE = 'Japanese',
  KOREAN = 'Korean',
  HINDI = 'Hindi',
  BENGALI = 'Bengali',
  PUNJABI = 'Punjabi',
  MARATHI = 'Marathi',
  TELUGU = 'Telugu',
  TAMIL = 'Tamil',
  URDU = 'Urdu',
  VIETNAMESE = 'Vietnamese',
  THAI = 'Thai',
  INDONESIAN = 'Indonesian',
  FILIPINO = 'Filipino',
  MALAY = 'Malay',
  // European
  GERMAN = 'German',
  ITALIAN = 'Italian',
  RUSSIAN = 'Russian',
  TURKISH = 'Turkish',
  DUTCH = 'Dutch',
  POLISH = 'Polish',
  SWEDISH = 'Swedish',
  NORWEGIAN = 'Norwegian',
  DANISH = 'Danish',
  FINNISH = 'Finnish',
  GREEK = 'Greek',
  CZECH = 'Czech',
  HUNGARIAN = 'Hungarian',
  ROMANIAN = 'Romanian',
  UKRAINIAN = 'Ukrainian',
  // Middle East / Africa
  ARABIC = 'Arabic (Modern Standard)',
  ARABIC_EG = 'Arabic (Egypt)',
  ARABIC_SA = 'Arabic (Saudi Arabia)',
  HEBREW = 'Hebrew',
  SWAHILI = 'Swahili',
  AMHARIC = 'Amharic'
}

export const LANGUAGE_CODES: Record<string, string> = {
  [SupportLanguage.ENGLISH_US]: 'en-US',
  [SupportLanguage.ENGLISH_UK]: 'en-GB',
  [SupportLanguage.ENGLISH_AU]: 'en-AU',
  [SupportLanguage.ENGLISH_IN]: 'en-IN',
  [SupportLanguage.ENGLISH_CA]: 'en-CA',
  [SupportLanguage.SPANISH_ES]: 'es-ES',
  [SupportLanguage.SPANISH_MX]: 'es-MX',
  [SupportLanguage.SPANISH_US]: 'es-US',
  [SupportLanguage.FRENCH_FR]: 'fr-FR',
  [SupportLanguage.FRENCH_CA]: 'fr-CA',
  [SupportLanguage.PORTUGUESE_BR]: 'pt-BR',
  [SupportLanguage.PORTUGUESE_PT]: 'pt-PT',
  [SupportLanguage.CHINESE_SIMP]: 'zh-CN',
  [SupportLanguage.CHINESE_TRAD]: 'zh-TW',
  [SupportLanguage.CANTONESE]: 'zh-HK',
  [SupportLanguage.JAPANESE]: 'ja-JP',
  [SupportLanguage.KOREAN]: 'ko-KR',
  [SupportLanguage.HINDI]: 'hi-IN',
  [SupportLanguage.BENGALI]: 'bn-BD',
  [SupportLanguage.PUNJABI]: 'pa-IN',
  [SupportLanguage.MARATHI]: 'mr-IN',
  [SupportLanguage.TELUGU]: 'te-IN',
  [SupportLanguage.TAMIL]: 'ta-IN',
  [SupportLanguage.URDU]: 'ur-PK',
  [SupportLanguage.VIETNAMESE]: 'vi-VN',
  [SupportLanguage.THAI]: 'th-TH',
  [SupportLanguage.INDONESIAN]: 'id-ID',
  [SupportLanguage.FILIPINO]: 'fil-PH',
  [SupportLanguage.MALAY]: 'ms-MY',
  [SupportLanguage.GERMAN]: 'de-DE',
  [SupportLanguage.ITALIAN]: 'it-IT',
  [SupportLanguage.RUSSIAN]: 'ru-RU',
  [SupportLanguage.TURKISH]: 'tr-TR',
  [SupportLanguage.DUTCH]: 'nl-NL',
  [SupportLanguage.POLISH]: 'pl-PL',
  [SupportLanguage.SWEDISH]: 'sv-SE',
  [SupportLanguage.NORWEGIAN]: 'no-NO',
  [SupportLanguage.DANISH]: 'da-DK',
  [SupportLanguage.FINNISH]: 'fi-FI',
  [SupportLanguage.GREEK]: 'el-GR',
  [SupportLanguage.CZECH]: 'cs-CZ',
  [SupportLanguage.HUNGARIAN]: 'hu-HU',
  [SupportLanguage.ROMANIAN]: 'ro-RO',
  [SupportLanguage.UKRAINIAN]: 'uk-UA',
  [SupportLanguage.ARABIC]: 'ar-XA',
  [SupportLanguage.ARABIC_EG]: 'ar-EG',
  [SupportLanguage.ARABIC_SA]: 'ar-SA',
  [SupportLanguage.HEBREW]: 'he-IL',
  [SupportLanguage.SWAHILI]: 'sw-KE',
  [SupportLanguage.AMHARIC]: 'am-ET'
};

export function resolveAutoLanguage(): SupportLanguage {
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  const fullLocale = navigator.language.toLowerCase();
  
  const fullMatch: Record<string, SupportLanguage> = {
    'en-us': SupportLanguage.ENGLISH_US,
    'en-gb': SupportLanguage.ENGLISH_UK,
    'en-au': SupportLanguage.ENGLISH_AU,
    'en-in': SupportLanguage.ENGLISH_IN,
    'en-ca': SupportLanguage.ENGLISH_CA,
    'es-es': SupportLanguage.SPANISH_ES,
    'es-mx': SupportLanguage.SPANISH_MX,
    'fr-fr': SupportLanguage.FRENCH_FR,
    'fr-ca': SupportLanguage.FRENCH_CA,
    'pt-br': SupportLanguage.PORTUGUESE_BR,
    'zh-cn': SupportLanguage.CHINESE_SIMP,
    'zh-tw': SupportLanguage.CHINESE_TRAD,
    'zh-hk': SupportLanguage.CANTONESE
  };

  if (fullMatch[fullLocale]) return fullMatch[fullLocale];

  const map: Record<string, SupportLanguage> = {
    'en': SupportLanguage.ENGLISH_US,
    'es': SupportLanguage.SPANISH_ES,
    'fr': SupportLanguage.FRENCH_FR,
    'de': SupportLanguage.GERMAN,
    'zh': SupportLanguage.CHINESE_SIMP,
    'ja': SupportLanguage.JAPANESE,
    'ko': SupportLanguage.KOREAN,
    'pt': SupportLanguage.PORTUGUESE_BR,
    'it': SupportLanguage.ITALIAN,
    'ru': SupportLanguage.RUSSIAN,
    'hi': SupportLanguage.HINDI,
    'ar': SupportLanguage.ARABIC,
    'bn': SupportLanguage.BENGALI,
    'tr': SupportLanguage.TURKISH,
    'vi': SupportLanguage.VIETNAMESE,
    'th': SupportLanguage.THAI,
    'id': SupportLanguage.INDONESIAN,
    'nl': SupportLanguage.DUTCH,
    'pl': SupportLanguage.POLISH,
    'sv': SupportLanguage.SWEDISH,
    'no': SupportLanguage.NORWEGIAN,
    'da': SupportLanguage.DANISH,
    'fi': SupportLanguage.FINNISH,
    'el': SupportLanguage.GREEK,
    'cs': SupportLanguage.CZECH,
    'hu': SupportLanguage.HUNGARIAN,
    'ro': SupportLanguage.ROMANIAN,
    'uk': SupportLanguage.UKRAINIAN,
    'he': SupportLanguage.HEBREW
  };
  return map[browserLang] || SupportLanguage.ENGLISH_US;
}

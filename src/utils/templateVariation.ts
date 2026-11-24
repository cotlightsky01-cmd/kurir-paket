export type WaTemplateCategory = 'cod' | 'nocod' | 'titip' | 'cod_only';

export interface BuildVariedTemplateParams {
  category: WaTemplateCategory;
  template: string;
  customerName: string;
  codFormatted: string;
  isNoCod?: boolean;
  titipLocationName?: string;
  customerSeed?: string;
  /** Optional explicit sequence/salt to force variation across customers */
  sequenceIndex?: number;
  /** Optional reference timestamp (defaults to Date.now()) */
  nowMs?: number;
}

const recentSkeletonsByCategory: Record<WaTemplateCategory, string[]> = {
  cod: [],
  nocod: [],
  titip: [],
  cod_only: [],
};

let globalSendCounter = 0;

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getTimeOfDayGreeting(nowMs: number): string {
  const hour = new Date(nowMs).getHours();
  if (hour >= 4 && hour < 11) return 'pagi';
  if (hour >= 11 && hour < 15) return 'siang';
  if (hour >= 15 && hour < 18) return 'sore';
  return 'malam';
}

interface PhraseRule {
  pattern: RegExp;
  variants: (ctx: { hasKak: boolean; timeOfDay: string }) => string[];
}

const BODY_PHRASE_RULES: PhraseRule[] = [
  {
    pattern: /\bsaya kurir\b/gi,
    variants: () => [
      'saya kurir',
      'saya kurir paket',
      'ini kurir paket',
      'kami dari pihak kurir',
      'saya kurir pengantar',
    ],
  },
  {
    pattern: /\bsudah kami antar ke lokasi\b/gi,
    variants: () => [
      'sudah kami antar ke lokasi',
      'telah kami antar ke lokasi',
      'sudah kami antarkan ke lokasi',
      'sudah diantar ke lokasi',
    ],
  },
  {
    pattern: /\b(?:mau|akan|sedang|siap)\s+(?:kami|saya)\s+(?:antar(?:kan)?|kirim(?:kan)?)\b/gi,
    variants: () => [
      'mau kami antar',
      'akan saya antarkan',
      'siap kami kirim',
      'sedang kami antar',
      'mau saya antarkan',
    ],
  },
  {
    pattern: /\b(?:mau|akan|sedang|siap)\s+di\s*(?:antar(?:kan)?|kirim(?:kan)?)\b/gi,
    variants: () => [
      'mau diantar',
      'akan segera diantar',
      'siap diantarkan',
      'sedang dalam pengantaran',
    ],
  },
  {
    pattern: /\b(?:sudah\s+)?(?:kami|saya)\s+titipkan\s+di\b/gi,
    variants: () => [
      'sudah kami titipkan di',
      'kami titipkan di',
      'telah kami titipkan di',
      'sudah dititipkan di',
      'kami titipkan sementara di',
    ],
  },
  {
    pattern: /\bhari ini ada paket\b/gi,
    variants: () => [
      'hari ini ada paket',
      'hari ini terdapat paket',
      'ada kiriman paket hari ini',
      'hari ini ada kiriman paket',
    ],
  },
  {
    pattern: /\b(?:dengan\s+)?nominal\b/gi,
    variants: () => [
      'nominal',
      'dengan nominal',
      'sebesar',
      'senilai',
      'total',
    ],
  },
  {
    pattern: /\bMohon disiapkan uang pas\b/gi,
    variants: () => [
      'Mohon disiapkan uang pas',
      'Mohon dibantu siapkan uang pas',
      'Tolong disiapkan uang pasnya',
      'Silakan siapkan uang pasnya',
    ],
  },
  {
    pattern: /\buang\s+pas\b/gi,
    variants: () => [
      'uang pas',
      'uang pasnya',
      'nominal pas',
      'pembayaran pas',
    ],
  },
  {
    pattern: /\bMohon dapat diambil\b/gi,
    variants: () => [
      'Mohon dapat diambil',
      'Silakan bisa diambil',
      'Mohon bisa segera diambil',
      'Bisa langsung diambil ya',
    ],
  },
  {
    pattern: /\b(?:mohon|tolong|harap|bisa|boleh)\s+(?:bantu\s+)?(?:kirim(?:kan)?|share)\s*(?:share\s*loc(?:k)?|sharelock|sharelokasi|lokasi|titik(?:\s+lokasi)?)\b/gi,
    variants: () => [
      'mohon kirim shareloc',
      'tolong kirimkan shareloc',
      'boleh dibantu kirim shareloc',
      'mohon bantu kirim share lokasi',
      'silakan kirimkan titik lokasinya',
    ],
  },
  {
    pattern: /\b(?:share\s*loc(?:k)?|sharelock|sharelokasi)\b/gi,
    variants: () => [
      'shareloc',
      'share lokasi',
      'titik lokasi',
      'shareloc-nya',
    ],
  },
  {
    pattern: /\bPaket COD Anda\b/gi,
    variants: () => [
      'Paket COD Anda',
      'Paket COD kakak',
      'Kiriman COD Anda',
      'Paket COD milik kakak',
    ],
  },
  {
    pattern: /\bPaket Non-COD Anda\b/gi,
    variants: () => [
      'Paket Non-COD Anda',
      'Paket Non-COD kakak',
      'Kiriman Non-COD Anda',
      'Paket Non-COD milik kakak',
    ],
  },
  {
    pattern: /\bpaket Anda\b/gi,
    variants: () => [
      'paket Anda',
      'paket kakak',
      'kiriman Anda',
      'paket milik kakak',
    ],
  },
  {
    pattern: /\bpaketnya\b/gi,
    variants: () => [
      'paketnya',
      'paket kakak',
      'kirimannya',
      'paket Anda',
    ],
  },
  {
    pattern: /\bsudah\s+sampai\b/gi,
    variants: () => [
      'sudah sampai',
      'telah tiba',
      'sudah tiba',
      'sudah sampai tujuan',
    ],
  },
  {
    pattern: /\bkonfirmasi\b/gi,
    variants: () => [
      'konfirmasi',
      'kabari',
      'info kembali',
      'balas pesan ini',
    ],
  },
];

function safePick<T>(arr: readonly T[], index: number): T {
  const len = arr.length;
  const safeIdx = ((index % len) + len) % len;
  return arr[safeIdx];
}

function applyGreetingVariation(
  text: string,
  variantNum: number,
  timeOfDay: string
): { text: string; matched: boolean } {
  const salaamMatch = text.match(
    /^(assalamu\s*['’]?\s*alaikum(?:\s+wr\.?\s*wb\.?)?)\b/i
  );
  if (salaamMatch) {
    const options = [
      salaamMatch[1],
      "Assalamu'alaikum kak",
      "Assalamu'alaikum, permisi",
      "Assalamu'alaikum, izin info",
      "Assalamu'alaikum, halo",
    ];
    const chosen = safePick(options, variantNum);
    return {
      text: chosen + text.slice(salaamMatch[0].length),
      matched: true,
    };
  }

  const greetingWithKakMatch = text.match(
    /^(permisi|halo|hallo|hai|selamat\s+(?:pagi|siang|sore|malam)|mohon\s+izin|izin\s+info|maaf\s+mengganggu)\s+(kak(?:ak)?|mbak|mas|bu|pak)\b/i
  );

  if (greetingWithKakMatch) {
    const addressWord = greetingWithKakMatch[2];
    const options = [
      `Permisi ${addressWord}`,
      `Halo ${addressWord}`,
      `Selamat ${timeOfDay} ${addressWord}`,
      `Izin info ${addressWord}`,
      `Permisi sebentar ${addressWord}`,
      `Mohon izin ${addressWord}`,
    ];
    const chosen = safePick(options, variantNum);
    return {
      text: chosen + text.slice(greetingWithKakMatch[0].length),
      matched: true,
    };
  }

  const greetingOnlyMatch = text.match(
    /^(permisi|halo|hallo|hai|selamat\s+(?:pagi|siang|sore|malam)|izin\s+info|mohon\s+izin)\b/i
  );
  if (greetingOnlyMatch) {
    const options = [
      'Permisi',
      'Halo',
      `Selamat ${timeOfDay}`,
      'Izin info',
      'Mohon izin',
    ];
    const chosen = safePick(options, variantNum);
    return {
      text: chosen + text.slice(greetingOnlyMatch[0].length),
      matched: true,
    };
  }

  // If custom template starts with "Kak {Nama}..."
  const directKakMatch = text.match(/^(kak(?:ak)?)\b/i);
  if (directKakMatch) {
    const kakWord = directKakMatch[1];
    const options = [
      `${kakWord}`,
      `Permisi ${kakWord.toLowerCase()}`,
      `Halo ${kakWord.toLowerCase()}`,
      `Selamat ${timeOfDay} ${kakWord.toLowerCase()}`,
      `Izin info ${kakWord.toLowerCase()}`,
    ];
    const chosen = safePick(options, variantNum);
    return {
      text: chosen + text.slice(directKakMatch[0].length),
      matched: true,
    };
  }

  return { text, matched: false };
}

function applyClosingVariation(text: string, variantNum: number): { text: string; matched: boolean } {
  const closingMatch = text.match(
    /(?:,\s*|\.\s*|\s+)((?:terima\s*kasih|terimakasih|makasih)(?:\s+(?:banyak|ya|kak|sebelumnya))*)\.?$/i
  );
  if (closingMatch) {
    const rawMatched = closingMatch[0];
    const separatorMatch = rawMatched.match(/^([,.\s]+)/);
    const sep = separatorMatch ? separatorMatch[1] : ' ';
    const startsUpper = /^[A-Z]/.test(closingMatch[1]);
    const rawOptions = [
      'terima kasih.',
      'terima kasih banyak.',
      'terima kasih ya kak.',
      'terima kasih sebelumnya.',
      'terima kasih ya.',
      'makasih banyak ya kak.',
    ];
    const chosenRaw = safePick(rawOptions, variantNum);
    const chosen = startsUpper
      ? chosenRaw.charAt(0).toUpperCase() + chosenRaw.slice(1)
      : chosenRaw;
    return {
      text: text.slice(0, text.length - rawMatched.length) + sep + chosen,
      matched: true,
    };
  }

  // Gentle trailing particle variation if ending with "ya." or "ya"
  const yaMatch = text.match(/\bya(\.?)$/i);
  if (yaMatch) {
    const yaOptions = ['ya.', 'ya kak.', 'ya, terima kasih.', 'ya kak, terima kasih.', 'ya, makasih.'];
    const chosen = safePick(yaOptions, variantNum);
    return {
      text: text.slice(0, text.length - yaMatch[0].length) + chosen,
      matched: true,
    };
  }

  return { text, matched: false };
}

function renderSingleVariant(
  template: string,
  params: BuildVariedTemplateParams,
  attemptSeed: number,
  forceExtraDiff = false
): { message: string; skeleton: string } {
  const nowMs = params.nowMs ?? Date.now();
  const timeOfDay = getTimeOfDayGreeting(nowMs);
  const safeName = (params.customerName || 'Kak').trim();
  const safeLoc = (params.titipLocationName || 'tempat titip').trim();

  // Handle Non-COD neatly in Titip template so it never reads "dengan nominal NO COD"
  let baseTemplate = (template || '').trim();
  if (params.category === 'titip' && params.isNoCod) {
    baseTemplate = baseTemplate.replace(
      /\bdengan\s+nominal\s+\{COD\}/gi,
      'tanpa COD (Non-COD)'
    );
  }

  // Build skeleton BEFORE inserting customer-specific values so anti-repeat guarantees distinct phrasing
  const hasKak = /\bkak\b/i.test(baseTemplate);
  let skeleton = baseTemplate;

  const greetingResult = applyGreetingVariation(skeleton, attemptSeed, timeOfDay);
  skeleton = greetingResult.text;

  // Apply targeted body phrase variations deterministically from attemptSeed
  // while keeping the overall structure closely aligned to the user's Settings template.
  let ruleStep = 0;
  for (const rule of BODY_PHRASE_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(skeleton)) {
      rule.pattern.lastIndex = 0;
      const options = rule.variants({ hasKak, timeOfDay });
      if (options.length > 1) {
        let replacedOnce = false;
        skeleton = skeleton.replace(rule.pattern, (match) => {
          if (replacedOnce) return match;
          replacedOnce = true;
          const candidate = safePick(options, attemptSeed + ruleStep * 3);
          if (/^[A-Z]/.test(match) && /^[a-z]/.test(candidate)) {
            return candidate.charAt(0).toUpperCase() + candidate.slice(1);
          }
          return candidate;
        });
      }
      ruleStep++;
    }
  }

  // Fallback subtle prefix when custom template had no standard greeting
  if (!greetingResult.matched && skeleton.length > 0) {
    const prefixes = [
      'Permisi kak, ',
      'Halo kak, ',
      `Selamat ${timeOfDay} kak, `,
      'Izin info kak, ',
      'Mohon izin kak, ',
      '',
    ];
    const prefix = safePick(prefixes, attemptSeed);
    if (prefix) {
      skeleton = prefix + skeleton;
    }
  }

  // Slight natural particle variation between "ya." / "ya kak." if still intact inside sentence
  if (attemptSeed % 3 === 1) {
    skeleton = skeleton.replace(/\s+ya\.(?=\s+[A-Z])/i, ' ya kak.');
  } else if (attemptSeed % 3 === 2) {
    skeleton = skeleton.replace(/\s+ya\s+kak\.(?=\s+[A-Z])/i, ' ya.');
  }

  const closingRes = applyClosingVariation(skeleton, attemptSeed >>> 1);
  skeleton = closingRes.text;

  // If custom template had neither a recognized closing nor enough phrase rules,
  // apply a gentle polite ending variant so consecutive messages still differ naturally.
  if ((!closingRes.matched && ruleStep === 0) || forceExtraDiff) {
    const softClosers = [
      ' ya kak.',
      ', terima kasih.',
      ', mohon konfirmasinya ya.',
      ', terima kasih sebelumnya.',
      '.',
    ];
    const trimmed = skeleton.replace(/[.!?\s]+$/, '');
    if (!/(?:terima\s*kasih|makasih|ya\s+kak|konfirmasinya)$/i.test(trimmed)) {
      skeleton = trimmed + safePick(softClosers, attemptSeed + 5);
    }
  }

  // Replace template placeholders cleanly
  const effectiveCod =
    params.category === 'titip' && params.isNoCod
      ? 'Non-COD'
      : params.codFormatted || 'NO COD';

  const message = skeleton
    .replace(/\{Nama\}/gi, safeName)
    .replace(/\{COD\}/gi, effectiveCod)
    .replace(/\{tempat cod\}/gi, safeLoc)
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { message, skeleton };
}

/**
 * Generates a message anchored strictly to the user's Settings template,
 * ensuring every customer (both automated and manual mode) receives slightly varied,
 * natural Indonesian phrasing without drifting away from the configured template structure.
 */
export function buildVariedTemplateMessage(params: BuildVariedTemplateParams): string {
  const baseSeedStr = `${params.category}|${params.customerSeed || params.customerName}|${params.sequenceIndex ?? 0}`;
  const baseHash = hashString(baseSeedStr);
  const counterSalt = ++globalSendCounter;
  const recentList = recentSkeletonsByCategory[params.category] || [];

  let chosenMessage = '';
  let chosenSkeleton = '';

  // Try up to 18 distinct offsets so consecutive sends (auto or manual) never reuse the same template phrasing
  for (let offset = 0; offset < 18; offset++) {
    const attemptSeed = (baseHash + counterSalt * 7 + offset * 13) >>> 0;
    const candidate = renderSingleVariant(
      params.template,
      params,
      attemptSeed,
      offset >= 12
    );
    chosenMessage = candidate.message;
    chosenSkeleton = candidate.skeleton;
    if (!recentList.includes(candidate.skeleton)) {
      break;
    }
  }

  recentList.push(chosenSkeleton);
  if (recentList.length > 10) {
    recentList.shift();
  }
  recentSkeletonsByCategory[params.category] = recentList;

  return chosenMessage;
}

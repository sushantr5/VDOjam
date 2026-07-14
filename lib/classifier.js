/**
 * Song origin classification: every submission is placed into one of two
 * buckets — "indian" or "western".
 *
 * Primary path: an LLM call against any OpenAI-compatible chat-completions
 * API (OpenAI, Groq, OpenRouter, Together, Ollama, ...). Configure with:
 *   LLM_API_KEY  (or OPENAI_API_KEY)  - bearer token
 *   LLM_API_URL  (optional)          - defaults to https://api.openai.com/v1/chat/completions
 *   LLM_MODEL    (optional)          - defaults to gpt-4o-mini
 *
 * Fallback path: a script + keyword heuristic that recognises Indic scripts,
 * Indian languages, film industries, labels, and artists. The app is fully
 * functional without any API key.
 */

export const CATEGORY_INDIAN = 'indian';
export const CATEGORY_WESTERN = 'western';
export const CATEGORIES = [CATEGORY_INDIAN, CATEGORY_WESTERN];

const LLM_API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 8000;

function getApiKey() {
  return process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || null;
}

export function isLlmConfigured() {
  return !!getApiKey();
}

// Unicode ranges for scripts used across the Indian subcontinent.
const INDIC_SCRIPT_PATTERN = new RegExp(
  '[' +
    '\u0900-\u097F' + // Devanagari (Hindi, Marathi, Nepali)
    '\u0980-\u09FF' + // Bengali, Assamese
    '\u0A00-\u0A7F' + // Gurmukhi (Punjabi)
    '\u0A80-\u0AFF' + // Gujarati
    '\u0B00-\u0B7F' + // Odia
    '\u0B80-\u0BFF' + // Tamil
    '\u0C00-\u0C7F' + // Telugu
    '\u0C80-\u0CFF' + // Kannada
    '\u0D00-\u0D7F' + // Malayalam
  ']'
);

const INDIAN_KEYWORDS = [
  // Languages & industries
  'bollywood', 'tollywood', 'kollywood', 'mollywood', 'sandalwood', 'lollywood',
  'hindi', 'punjabi', 'tamil', 'telugu', 'kannada', 'malayalam', 'marathi',
  'bengali', 'bangla', 'gujarati', 'bhojpuri', 'haryanvi', 'rajasthani', 'odia', 'assamese',
  'desi', 'indian', 'hindustani', 'carnatic', 'qawwali', 'ghazal', 'bhajan',
  'kirtan', 'aarti', 'sufi', 'garba', 'bhangra', 'lavani', 'dandiya', 'filmi',
  'lofi bollywood', 'indipop',
  // Labels & channels
  't-series', 'tseries', 'zee music', 'saregama', 'sony music india', 'yrf',
  'tips official', 'tips music', 'venus movies', 'eros now', 'shemaroo',
  'speed records', 'white hill music', 'desi melodies', 'aditya music',
  'lahari music', 'think music', 'manorama music', 'anand audio', 'coke studio',
  // Iconic artists (titles/channels frequently include these)
  'arijit singh', 'shreya ghoshal', 'lata mangeshkar', 'kishore kumar',
  'mohammed rafi', 'sonu nigam', 'a r rahman', 'a. r. rahman', 'ar rahman',
  'anirudh', 'ilaiyaraaja', 'ilayaraja', 'shankar mahadevan', 'sid sriram',
  'kk ', 'atif aslam', 'rahat fateh', 'nusrat fateh', 'diljit dosanjh',
  'sidhu moose', 'karan aujla', 'ap dhillon', 'badshah', 'yo yo honey singh',
  'honey singh', 'guru randhawa', 'neha kakkar', 'jubin nautiyal', 'b praak',
  'darshan raval', 'armaan malik', 'vishal-shekhar', 'vishal mishra',
  'amit trivedi', 'pritam', 'anuv jain', 'prateek kuhad', 'kumar sanu',
  'udit narayan', 'alka yagnik', 'sunidhi chauhan', 'shankar-ehsaan-loy',
  'sachin-jigar', 'tanishk bagchi', 'dhvani bhanushali', 'king ',
  // Common song words that are a strong signal in titles
  ' gaana', ' geet', 'sangeet', ' dhun', 'mashup bollywood'
];

function normalize(text) {
  return ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
}

/**
 * Deterministic fallback classifier. Returns a category plus the reason the
 * decision was made, so the UI can surface how the song was bucketed.
 */
export function classifyHeuristically({ title, channel }) {
  const combined = `${title || ''} ${channel || ''}`;
  if (INDIC_SCRIPT_PATTERN.test(combined)) {
    return {
      category: CATEGORY_INDIAN,
      source: 'heuristic',
      reason: 'Title or channel uses an Indic script'
    };
  }
  const haystack = normalize(combined);
  for (const keyword of INDIAN_KEYWORDS) {
    const needle = keyword.startsWith(' ') || keyword.endsWith(' ') ? keyword : ` ${keyword}`;
    if (haystack.includes(needle.toLowerCase())) {
      return {
        category: CATEGORY_INDIAN,
        source: 'heuristic',
        reason: `Matched keyword "${keyword.trim()}"`
      };
    }
  }
  return {
    category: CATEGORY_WESTERN,
    source: 'heuristic',
    reason: 'No Indian-music signals found'
  };
}

async function classifyWithLlm({ title, channel }) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: [
              'You classify songs for a party playlist. Decide whether a song is INDIAN or WESTERN.',
              'INDIAN: music from the Indian subcontinent — Bollywood and other Indian film music, Hindi/Punjabi/Tamil/Telugu/Kannada/Malayalam/Bengali/Marathi/Gujarati/Bhojpuri songs, Indian classical, devotional, indipop, Indian indie, Pakistani/qawwali/ghazal music.',
              'WESTERN: everything else — pop, rock, hip-hop, EDM, Latin, K-pop, J-pop, and any other non-Indian music.',
              'Respond with ONLY a JSON object: {"category":"indian"|"western","confidence":0-1,"reason":"short explanation"}'
            ].join('\n')
          },
          {
            role: 'user',
            content: `Song title: ${title || 'Unknown'}\nChannel/artist: ${channel || 'Unknown'}`
          }
        ]
      })
    });
    if (!response.ok) {
      console.warn(`LLM classification failed with status ${response.status}`);
      return null;
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const category = String(parsed.category || '').toLowerCase();
    if (!CATEGORIES.includes(category)) return null;
    return {
      category,
      source: 'llm',
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : null
    };
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('LLM classification error:', error.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify a song into the Indian or Western bucket. Uses the LLM when
 * configured and silently degrades to the heuristic on any failure.
 */
export async function classifySong({ title, channel }) {
  const llmResult = await classifyWithLlm({ title, channel });
  if (llmResult) return llmResult;
  return classifyHeuristically({ title, channel });
}

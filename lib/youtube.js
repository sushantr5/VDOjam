const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

export function extractYouTubeId(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch (error) {
    return null;
  }
  let candidate = null;
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parsed.searchParams.has('v')) {
      candidate = parsed.searchParams.get('v');
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) {
        candidate = parts[1];
      }
    }
  }
  if (candidate && VIDEO_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return null;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch title/channel/thumbnail for a video. Tries the official YouTube
 * oEmbed endpoint first, then falls back to noembed.com. Never throws.
 */
export async function fetchYoutubeDetails(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const sources = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
    `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`
  ];
  for (const source of sources) {
    const data = await fetchJson(source, 5000);
    if (data && data.title) {
      return {
        title: data.title,
        author: data.author_name || null,
        thumbnail: data.thumbnail_url || null
      };
    }
  }
  return null;
}

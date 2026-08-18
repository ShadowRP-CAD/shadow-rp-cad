const PROFILE_HANDLE = 'playerv2';
const PROFILE_API = `https://studio-api.prod.suno.com/api/profiles/${PROFILE_HANDLE}`;
const CACHE_MS = 30 * 60_000;
let cache = { expiresAt: 0, tracks: [] };

const safeHttpsUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export function normalizeSunoClips(clips = []) {
  const seen = new Set();
  return clips.flatMap(clip => {
    const id = String(clip?.id || '').trim();
    const title = String(clip?.title || '').trim();
    const audio = safeHttpsUrl(clip?.audio_url || (id ? `https://cdn1.suno.ai/${id}.mp3` : ''));
    if (!id || !title || !audio || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      title: title.slice(0, 160),
      audio,
      image: safeHttpsUrl(clip.image_url || clip.image_large_url),
      page: `https://suno.com/song/${id}`,
      artist: String(clip.display_name || clip.handle || 'Playa').slice(0, 80)
    }];
  });
}

export async function getPublicSunoTracks({ force = false } = {}) {
  if (!force && cache.expiresAt > Date.now() && cache.tracks.length) return cache.tracks;
  const clips = [];
  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({ page: String(page), playlists_sort_by: 'created_at', clips_sort_by: 'created_at' });
    const response = await fetch(`${PROFILE_API}?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ShadowRP-CAD/1.0' },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`Suno profile request failed (${response.status})`);
    const data = await response.json();
    const pageClips = Array.isArray(data?.clips) ? data.clips : [];
    clips.push(...pageClips);
    if (!pageClips.length || pageClips.length < 20) break;
  }
  const tracks = normalizeSunoClips(clips);
  if (!tracks.length) throw new Error('No public Suno songs were returned');
  cache = { expiresAt: Date.now() + CACHE_MS, tracks };
  return tracks;
}


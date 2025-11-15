import { API_ENDPOINTS, JIKAN_API, CONFIG } from './constants.js';
import { sleep } from './utils.js';

export async function uploadList(animeList, allAnimeIds, stats) {
  const response = await fetch(API_ENDPOINTS.UPLOAD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      animeList,
      allAnimeIds: Array.from(allAnimeIds),
      stats
    })
  });

  if (!response.ok) {
    throw new Error('Failed to upload list');
  }

  return await response.json();
}

export async function loadList(id) {
  const response = await fetch(API_ENDPOINTS.LIST(id));

  if (!response.ok) {
    throw new Error('List not found');
  }

  return await response.json();
}

export async function generateRecommendations(listId) {
  const response = await fetch(API_ENDPOINTS.GENERATE(listId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to generate recommendations');
  }

  return await response.json();
}

export async function saveRecommendations(listId, recommendations) {
  const response = await fetch(API_ENDPOINTS.RECOMMEND(listId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendations })
  });

  if (!response.ok) {
    throw new Error('Failed to save recommendations');
  }

  return await response.json();
}

export async function fetchJikanAPI(url, retries = CONFIG.JIKAN.RETRY_ATTEMPTS) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        const waitTime = (attempt + 1) * CONFIG.JIKAN.RETRY_BASE_DELAY;
        await sleep(waitTime);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.data || {};
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(CONFIG.JIKAN.RETRY_BASE_DELAY);
    }
  }
  return {};
}

export async function fetchAnimeDetails(animeId) {
  return await fetchJikanAPI(JIKAN_API.ANIME(animeId));
}

export async function fetchAnimeRecommendations(animeId) {
  return await fetchJikanAPI(JIKAN_API.RECOMMENDATIONS(animeId));
}

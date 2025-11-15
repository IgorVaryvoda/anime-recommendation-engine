export const CONFIG = {
  ITEMS_PER_PAGE: 20,
  MAX_VISIBLE_PAGES: 5,
  MIN_SCORE_THRESHOLD: 8,
  TOP_ANIME_DISPLAY_LIMIT: 12,
  JIKAN: {
    RATE_LIMIT_DELAY: 350,
    RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY: 2000,
  },
};

export const SORT_OPTIONS = {
  COUNT: 'count',
  SCORE: 'score',
  TITLE: 'title',
};

export const API_ENDPOINTS = {
  UPLOAD: '/api/upload',
  LIST: (id) => `/api/list/${id}`,
  RECOMMEND: (id) => `/api/recommend/${id}`,
  GENERATE: (id) => `/api/generate-recommendations/${id}`,
};

export const JIKAN_API = {
  BASE_URL: 'https://api.jikan.moe/v4',
  ANIME: (id) => `https://api.jikan.moe/v4/anime/${id}`,
  RECOMMENDATIONS: (id) => `https://api.jikan.moe/v4/anime/${id}/recommendations`,
};

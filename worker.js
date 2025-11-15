import { nanoid } from 'nanoid';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  ALLOWED_ORIGINS: [
    'https://anime.varyvoda.com',
    'https://anime-recommendations.cheguevaraua.workers.dev',
    'http://localhost:8787',
    'http://localhost:8000'
  ],
  LIMITS: {
    MAX_UPLOAD_SIZE: 10_000_000,      // 10MB
    MAX_RECOMMEND_SIZE: 5_000_000,    // 5MB
    MAX_ANIME_ENTRIES: 1000,
    MAX_RECOMMENDATIONS: 500,
    MAX_TITLE_LENGTH: 500,
    LIST_ID_LENGTH: 10,
    MAX_DETAIL_FETCH: 50,             // Limit detail fetching
  },
  JIKAN: {
    BASE_URL: 'https://api.jikan.moe/v4',
    RETRY_ATTEMPTS: 3,
    RATE_LIMIT_DELAY: 1000,           // 1 second
    DETAIL_DELAY: 350,                // 350ms
    RETRY_DELAY: 2000,                // 2 seconds
    RECS_PER_ANIME: 10                // Recommendations to fetch per anime
  },
  CACHE: {
    MAX_AGE: 3600                     // 1 hour
  }
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

function validateAnimeList(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }

  if (!Array.isArray(data.animeList)) {
    throw new Error('Invalid animeList format');
  }

  if (data.animeList.length > CONFIG.LIMITS.MAX_ANIME_ENTRIES) {
    throw new Error(`Too many anime entries (max ${CONFIG.LIMITS.MAX_ANIME_ENTRIES})`);
  }

  if (!Array.isArray(data.allAnimeIds)) {
    throw new Error('Invalid allAnimeIds format');
  }

  for (const anime of data.animeList) {
    if (!anime.id || !anime.title || typeof anime.score !== 'number') {
      throw new Error('Invalid anime entry');
    }

    if (anime.score < 0 || anime.score > 10) {
      throw new Error('Invalid score range (must be 0-10)');
    }

    if (anime.title.length > CONFIG.LIMITS.MAX_TITLE_LENGTH) {
      throw new Error('Title too long');
    }
  }

  return true;
}

function validateRecommendations(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }

  const { MAX_RECOMMENDATIONS } = CONFIG.LIMITS;

  if (!Array.isArray(data.recommendations)) {
    throw new Error('Invalid recommendations format');
  }

  if (data.recommendations.length > MAX_RECOMMENDATIONS) {
    throw new Error('Too many recommendations');
  }

  return true;
}

function validateListId(listId) {
  const pattern = new RegExp(`^[a-zA-Z0-9_-]{${CONFIG.LIMITS.LIST_ID_LENGTH}}$`);
  return listId && pattern.test(listId);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getCorsHeaders(origin) {
  const allowedOrigin = CONFIG.ALLOWED_ORIGINS.includes(origin)
    ? origin
    : CONFIG.ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function createJsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function createErrorResponse(error, status = 400, corsHeaders = {}) {
  // Sanitize error messages - only expose validation errors
  const userMessage = error.message.includes('Invalid') || error.message.includes('Too many')
    ? error.message
    : 'An error occurred processing your request';

  return createJsonResponse({ error: userMessage }, status, corsHeaders);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// JIKAN API FUNCTIONS
// ============================================================================

async function fetchJikanAPI(url, retries = CONFIG.JIKAN.RETRY_ATTEMPTS) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);

      // Handle rate limiting
      if (response.status === 429) {
        const waitTime = (attempt + 1) * CONFIG.JIKAN.RETRY_DELAY;
        await delay(waitTime);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await delay(CONFIG.JIKAN.RETRY_DELAY);
    }
  }
  return null;
}

async function fetchAnimeRecommendations(animeId) {
  const url = `${CONFIG.JIKAN.BASE_URL}/anime/${animeId}/recommendations`;
  return await fetchJikanAPI(url);
}

async function fetchAnimeDetails(animeId, env = null) {
  // Try to get from cache first
  if (env) {
    const cached = await env.DB.prepare(
      'SELECT title, image_url, anime_type, score FROM anime_cache WHERE mal_id = ?'
    )
      .bind(animeId)
      .first();

    if (cached) {
      return {
        data: {
          mal_id: animeId,
          title: cached.title,
          images: { jpg: { image_url: cached.image_url, large_image_url: cached.image_url } },
          type: cached.anime_type,
          score: cached.score
        }
      };
    }
  }

  // Fetch from API if not cached
  const url = `${CONFIG.JIKAN.BASE_URL}/anime/${animeId}`;
  const result = await fetchJikanAPI(url);

  // Cache the result
  if (env && result && result.data) {
    const now = Date.now();
    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO anime_cache (mal_id, title, image_url, anime_type, score, cached_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(
          animeId,
          result.data.title,
          result.data.images?.jpg?.image_url || result.data.images?.jpg?.large_image_url,
          result.data.type,
          result.data.score,
          now
        )
        .run();
    } catch (err) {
      console.error('Error caching anime details:', err);
    }
  }

  return result;
}

// ============================================================================
// RECOMMENDATION ENGINE
// ============================================================================

async function generateRecommendations(animeList, allAnimeIds, maxTopAnime = null, env = null) {
  // Get top rated anime (score >= 8)
  const allTopAnime = animeList
    .filter(a => a.score >= 8)
    .sort((a, b) => b.score - a.score);

  // If maxTopAnime is specified, limit to that number, otherwise use all
  const topAnime = maxTopAnime ? allTopAnime.slice(0, maxTopAnime) : allTopAnime;

  console.log(`Analyzing ${topAnime.length} top-rated anime (max: ${maxTopAnime})`);

  // Collect recommendations with frequency counting
  const recCounter = {};
  const recDetails = {};

  for (let i = 0; i < topAnime.length; i++) {
    const anime = topAnime[i];

    try {
      const recsData = await fetchAnimeRecommendations(anime.id);

      if (recsData && recsData.data) {
        for (let rec of recsData.data.slice(0, CONFIG.JIKAN.RECS_PER_ANIME)) {
          const recId = String(rec.entry.mal_id);

          // Only include anime not in user's list
          if (!allAnimeIds.has(recId)) {
            const title = rec.entry.title;
            recCounter[title] = (recCounter[title] || 0) + 1;

            if (!recDetails[title]) {
              recDetails[title] = {
                id: recId,
                url: rec.entry.url,
              };
            }
          }
        }
      }

      // Rate limiting between requests
      await delay(CONFIG.JIKAN.RATE_LIMIT_DELAY);

      // Log progress every 10 anime
      if ((i + 1) % 10 === 0) {
        console.log(`Progress: ${i + 1}/${topAnime.length} anime processed`);
      }
    } catch (err) {
      console.error(`Error fetching recommendations for ${anime.title}:`, err);
    }
  }

  // Sort by recommendation count (return all results)
  const sorted = Object.entries(recCounter)
    .map(([title, count]) => ({
      title,
      count,
      id: recDetails[title].id,
    }))
    .sort((a, b) => b.count - a.count);

  console.log(`Found ${sorted.length} unique recommendations, fetching details for top ${CONFIG.LIMITS.MAX_DETAIL_FETCH}...`);

  // Enrich with anime details from cache only (super fast)
  for (let i = 0; i < sorted.length; i++) {
    const rec = sorted[i];
    if (env) {
      const cached = await env.DB.prepare(
        'SELECT title, image_url, anime_type, score FROM anime_cache WHERE mal_id = ?'
      )
        .bind(rec.id)
        .first();

      if (cached) {
        rec.image = cached.image_url;
        rec.type = cached.anime_type;
        rec.score = cached.score;
        rec.mal_id = rec.id;
      } else {
        // Mark as needing fetch
        rec.image = null;
        rec.type = null;
        rec.score = null;
        rec.mal_id = rec.id;
      }
    } else {
      rec.image = null;
      rec.type = null;
      rec.score = null;
      rec.mal_id = rec.id;
    }
  }

  console.log(`Returning ${sorted.length} recommendations (enriched from cache)`);
  return sorted;
}

// ============================================================================
// QUEUE HANDLERS
// ============================================================================

async function queueAnimeDetailsForFetching(animeIds, env) {
  if (!env.ANIME_DETAILS_QUEUE) {
    console.log('No queue available, skipping background fetch');
    return;
  }

  const batch = animeIds.map(id => ({ body: { animeId: id } }));

  try {
    await env.ANIME_DETAILS_QUEUE.sendBatch(batch);
    console.log(`Queued ${batch.length} anime for background detail fetching`);
  } catch (err) {
    console.error('Error queuing anime details:', err);
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

async function handleUpload(request, env, corsHeaders) {
  try {
    // Check payload size
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > CONFIG.LIMITS.MAX_UPLOAD_SIZE) {
      return createJsonResponse({ error: 'Payload too large' }, 413, corsHeaders);
    }

    const data = await request.json();
    validateAnimeList(data);

    const { animeList, allAnimeIds, stats } = data;
    const id = nanoid(CONFIG.LIMITS.LIST_ID_LENGTH);
    const now = Date.now();

    // Save to database
    await env.DB.prepare(
      'INSERT INTO user_lists (id, anime_list, all_anime_ids, stats, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        JSON.stringify(animeList),
        JSON.stringify(allAnimeIds),
        JSON.stringify(stats),
        now,
        now
      )
      .run();

    return createJsonResponse(
      { id, url: `${new URL(request.url).origin}/${id}` },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error('Upload error:', err);
    return createErrorResponse(err, 400, corsHeaders);
  }
}

async function handleSaveRecommendations(request, env, listId, corsHeaders) {
  try {
    // Check payload size
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > CONFIG.LIMITS.MAX_RECOMMEND_SIZE) {
      return createJsonResponse({ error: 'Payload too large' }, 413, corsHeaders);
    }

    // Validate list ID
    if (!validateListId(listId)) {
      return createJsonResponse({ error: 'Invalid list ID' }, 400, corsHeaders);
    }

    const data = await request.json();
    validateRecommendations(data);

    const { recommendations } = data;
    const now = Date.now();

    // Save to database
    await env.DB.prepare(
      'INSERT INTO recommendations (list_id, recommendations, top_count, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(listId, JSON.stringify(recommendations), null, now)
      .run();

    return createJsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    console.error('SaveRecommendations error:', err);
    return createErrorResponse(err, 400, corsHeaders);
  }
}

async function handleGetList(request, env, listId, corsHeaders) {
  try {
    // Validate list ID
    if (!validateListId(listId)) {
      return createJsonResponse({ error: 'Invalid list ID format' }, 400, corsHeaders);
    }

    // Get user list from database
    const listResult = await env.DB.prepare(
      'SELECT anime_list, all_anime_ids, stats FROM user_lists WHERE id = ?'
    )
      .bind(listId)
      .first();

    if (!listResult) {
      return createJsonResponse({ error: 'List not found' }, 404, corsHeaders);
    }

    // Get latest recommendations
    const recsResult = await env.DB.prepare(
      'SELECT recommendations, top_count FROM recommendations WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(listId)
      .first();

    const responseData = {
      animeList: JSON.parse(listResult.anime_list),
      allAnimeIds: JSON.parse(listResult.all_anime_ids),
      stats: JSON.parse(listResult.stats),
      recommendations: recsResult ? JSON.parse(recsResult.recommendations) : null,
      topCount: recsResult ? recsResult.top_count : null,
    };

    return new Response(JSON.stringify(responseData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CONFIG.CACHE.MAX_AGE}`,
      },
    });
  } catch (err) {
    console.error('GetList error:', err);
    return createJsonResponse({ error: 'Failed to retrieve list' }, 500, corsHeaders);
  }
}

async function handleGenerateRecommendations(request, env, listId, corsHeaders, ctx) {
  try {
    // Validate list ID
    if (!validateListId(listId)) {
      return createJsonResponse({ error: 'Invalid list ID format' }, 400, corsHeaders);
    }

    // Check if recommendations already exist for this list
    const existingRecs = await env.DB.prepare(
      'SELECT recommendations, top_count FROM recommendations WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(listId)
      .first();

    if (existingRecs) {
      const cachedRecommendations = JSON.parse(existingRecs.recommendations);
      console.log(`Using cached recommendations for ${listId} (${cachedRecommendations.length} items)`);

      return createJsonResponse({
        success: true,
        recommendations: cachedRecommendations,
        count: cachedRecommendations.length,
        analyzedAnime: existingRecs.top_count,
        cacheMisses: 0,
        cached: true,
      }, 200, corsHeaders);
    }

    // Parse request body for optional parameters
    const body = await request.json().catch(() => ({}));
    const maxTopAnime = body.maxTopAnime || null; // null means analyze all top-rated anime

    // Get user list from database
    const listResult = await env.DB.prepare(
      'SELECT anime_list, all_anime_ids FROM user_lists WHERE id = ?'
    )
      .bind(listId)
      .first();

    if (!listResult) {
      return createJsonResponse({ error: 'List not found' }, 404, corsHeaders);
    }

    const animeList = JSON.parse(listResult.anime_list);
    const allAnimeIds = new Set(JSON.parse(listResult.all_anime_ids));

    console.log(`Starting recommendation generation for ${listId}, max: ${maxTopAnime}`);

    // Generate recommendations with configurable limit
    const recommendations = await generateRecommendations(animeList, allAnimeIds, maxTopAnime, env);

    console.log(`Generated ${recommendations.length} recommendations, saving to database...`);

    // Save to database
    const now = Date.now();
    const actualTopCount = animeList.filter(a => a.score >= 8).length;
    await env.DB.prepare(
      'INSERT INTO recommendations (list_id, recommendations, top_count, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(listId, JSON.stringify(recommendations), actualTopCount, now)
      .run();

    console.log(`Recommendations saved successfully`);

    // Queue missing anime details for background fetching
    const missingAnime = recommendations
      .filter(rec => !rec.image || !rec.type)
      .map(rec => rec.id);

    if (missingAnime.length > 0) {
      console.log(`Queueing ${missingAnime.length} anime for background detail fetching`);
      await queueAnimeDetailsForFetching(missingAnime, env);
    }

    return createJsonResponse({
      success: true,
      recommendations,
      count: recommendations.length,
      analyzedAnime: actualTopCount,
      cacheMisses: missingAnime.length,
    }, 200, corsHeaders);
  } catch (err) {
    console.error('GenerateRecommendations error:', err);
    return createJsonResponse({ error: 'Failed to generate recommendations: ' + err.message }, 500, corsHeaders);
  }
}

async function handleStaticFile(request, env, ctx) {
  const url = new URL(request.url);

  // Try to serve specific assets first using getAssetFromKV with manifest
  if (url.pathname.includes('.')) {
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: typeof __STATIC_CONTENT_MANIFEST !== 'undefined'
            ? JSON.parse(__STATIC_CONTENT_MANIFEST)
            : {},
        }
      );
    } catch (e) {
      // If manifest lookup fails, try direct lookup with hashed name
      try {
        const baseName = url.pathname.split('/').pop().split('.')[0];
        const ext = url.pathname.split('.').pop();
        const keys = await env.__STATIC_CONTENT.list({ prefix: `${baseName}.` });

        if (keys.keys && keys.keys.length > 0) {
          const hashedKey = keys.keys.find(k => k.name.endsWith(`.${ext}`));
          if (hashedKey) {
            const content = await env.__STATIC_CONTENT.get(hashedKey.name);
            if (content) {
              const contentType = ext === 'css' ? 'text/css' :
                                  ext === 'js' ? 'application/javascript' :
                                  'application/octet-stream';
              return new Response(content, {
                headers: {
                  'Content-Type': contentType,
                  'Cache-Control': `public, max-age=${CONFIG.CACHE.MAX_AGE}`,
                },
              });
            }
          }
        }
      } catch (e2) {
        console.error('Asset lookup error:', e2);
      }
      return new Response('Asset not found', { status: 404 });
    }
  }

  // For all other routes (SPA), serve index.html
  try {
    // First try using getAssetFromKV for development/production compatibility
    try {
      const indexRequest = new Request(new URL('/index.html', request.url));
      return await getAssetFromKV(
        { request: indexRequest, waitUntil: ctx.waitUntil.bind(ctx) },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: typeof __STATIC_CONTENT_MANIFEST !== 'undefined'
            ? JSON.parse(__STATIC_CONTENT_MANIFEST)
            : {},
        }
      );
    } catch (kvError) {
      // If getAssetFromKV fails, try to find hashed index file (production)
      const keys = await env.__STATIC_CONTENT.list({ prefix: 'index.' });

      if (keys.keys && keys.keys.length > 0) {
        const indexKey = keys.keys[0].name;
        const html = await env.__STATIC_CONTENT.get(indexKey);

        if (html) {
          return new Response(html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': `public, max-age=${CONFIG.CACHE.MAX_AGE}`,
            },
          });
        }
      }

      throw new Error('No HTML files found');
    }
  } catch (e) {
    console.error('Static file error:', e);
    return new Response('Error loading page: ' + e.message, { status: 500 });
  }
}

// ============================================================================
// ROUTER
// ============================================================================

function route(url) {
  const { pathname } = url;

  // API routes
  if (pathname === '/api/upload') {
    return { handler: handleUpload };
  }

  if (pathname.startsWith('/api/recommend/')) {
    const id = pathname.split('/')[3];
    return { handler: handleSaveRecommendations, params: { id } };
  }

  if (pathname.startsWith('/api/list/')) {
    const id = pathname.split('/')[3];
    return { handler: handleGetList, params: { id } };
  }

  if (pathname.startsWith('/api/generate-recommendations/')) {
    const id = pathname.split('/')[3];
    return { handler: handleGenerateRecommendations, params: { id } };
  }

  // Default: serve static file (SPA)
  return { handler: handleStaticFile, params: {} };
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route the request
    const { handler, params } = route(url);

    // Call handler with appropriate parameters
    if (handler === handleStaticFile) {
      return handler(request, env, ctx);
    } else if (params && params.id) {
      return handler(request, env, params.id, corsHeaders, ctx);
    } else {
      return handler(request, env, corsHeaders);
    }
  },

  async queue(batch, env) {
    console.log(`Processing ${batch.messages.length} anime detail requests from queue`);

    for (const message of batch.messages) {
      const { animeId } = message.body;

      try {
        // Check if already cached
        const cached = await env.DB.prepare(
          'SELECT 1 FROM anime_cache WHERE mal_id = ?'
        )
          .bind(animeId)
          .first();

        if (cached) {
          console.log(`Anime ${animeId} already cached, acking`);
          message.ack();
          continue;
        }

        // Fetch from API
        console.log(`Fetching details for anime ${animeId}`);
        const details = await fetchAnimeDetails(animeId, env);

        if (details && details.data) {
          console.log(`Successfully cached anime ${animeId}: ${details.data.title}`);
          message.ack();
        } else {
          console.log(`Failed to fetch details for anime ${animeId}, will retry`);
          message.retry();
        }

        // Rate limit
        await delay(CONFIG.JIKAN.DETAIL_DELAY);
      } catch (err) {
        console.error(`Error processing anime ${animeId}:`, err);
        message.retry();
      }
    }
  }
};

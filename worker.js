import { nanoid } from 'nanoid';

// Validation helpers
function validateAnimeList(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }

  if (!Array.isArray(data.animeList)) {
    throw new Error('Invalid animeList format');
  }

  if (data.animeList.length > 1000) {
    throw new Error('Too many anime entries (max 1000)');
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

    if (anime.title.length > 500) {
      throw new Error('Title too long');
    }
  }

  return true;
}

function validateRecommendations(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }

  if (typeof data.topCount !== 'number' || data.topCount < 1 || data.topCount > 50) {
    throw new Error('Invalid topCount (must be 1-50)');
  }

  if (!Array.isArray(data.recommendations)) {
    throw new Error('Invalid recommendations format');
  }

  if (data.recommendations.length > 100) {
    throw new Error('Too many recommendations');
  }

  return true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers - restrict to own domain in production
    const origin = request.headers.get('Origin');
    const allowedOrigins = [
      'https://anime.varyvoda.com',
      'https://anime-recommendations.cheguevaraua.workers.dev',
      'http://localhost:8787',
      'http://localhost:8000'
    ];

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (url.pathname === '/api/upload') {
      return handleUpload(request, env, corsHeaders);
    }

    if (url.pathname.startsWith('/api/recommend/')) {
      const id = url.pathname.split('/')[3];
      return handleRecommend(request, env, id, corsHeaders);
    }

    if (url.pathname.startsWith('/api/list/')) {
      const id = url.pathname.split('/')[3];
      return handleGetList(request, env, id, corsHeaders);
    }

    // For SPA routing: serve index.html for all non-API routes
    // Auto-detect the latest index.html hash from KV
    try {
      // List all keys with 'index.' prefix to find the latest
      const keys = await env.__STATIC_CONTENT.list({ prefix: 'index.' });

      if (!keys.keys || keys.keys.length === 0) {
        return new Response('No HTML files found', { status: 404 });
      }

      // Get the first (and likely only) index file
      const indexKey = keys.keys[0].name;
      const html = await env.__STATIC_CONTENT.get(indexKey);

      if (!html) {
        return new Response('HTML not found in KV', { status: 404 });
      }

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (e) {
      console.error('Static file error:', e);
      return new Response('Error loading page', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

async function handleUpload(request, env, corsHeaders) {
  try {
    // Payload size limit (10MB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10_000_000) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json();

    // Validate input
    validateAnimeList(data);

    const { animeList, allAnimeIds, stats } = data;

    // Generate unique ID
    const id = nanoid(10);
    const now = Date.now();

    // Save to D1
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

    return new Response(
      JSON.stringify({ id, url: `${new URL(request.url).origin}/${id}` }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    // Sanitize error messages - don't leak internal details
    console.error('Upload error:', err);
    const userMessage = err.message.includes('Invalid') || err.message.includes('Too many')
      ? err.message
      : 'Failed to save anime list';

    return new Response(JSON.stringify({ error: userMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleRecommend(request, env, listId, corsHeaders) {
  try {
    // Payload size limit
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 5_000_000) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json();

    // Validate input
    validateRecommendations(data);

    const { topCount, recommendations } = data;
    const now = Date.now();

    // Validate listId format
    if (!listId || listId.length !== 10) {
      return new Response(JSON.stringify({ error: 'Invalid list ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Save recommendations to D1
    await env.DB.prepare(
      'INSERT INTO recommendations (list_id, recommendations, top_count, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(listId, JSON.stringify(recommendations), topCount, now)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Recommend error:', err);
    const userMessage = err.message.includes('Invalid') || err.message.includes('Too many')
      ? err.message
      : 'Failed to save recommendations';

    return new Response(JSON.stringify({ error: userMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetList(request, env, listId, corsHeaders) {
  try {
    // Validate listId format
    if (!listId || !/^[a-zA-Z0-9_-]{10}$/.test(listId)) {
      return new Response(JSON.stringify({ error: 'Invalid list ID format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user list
    const listResult = await env.DB.prepare(
      'SELECT anime_list, all_anime_ids, stats FROM user_lists WHERE id = ?'
    )
      .bind(listId)
      .first();

    if (!listResult) {
      return new Response(JSON.stringify({ error: 'List not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get latest recommendations for this list
    const recsResult = await env.DB.prepare(
      'SELECT recommendations, top_count FROM recommendations WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(listId)
      .first();

    return new Response(
      JSON.stringify({
        animeList: JSON.parse(listResult.anime_list),
        allAnimeIds: JSON.parse(listResult.all_anime_ids),
        stats: JSON.parse(listResult.stats),
        recommendations: recsResult ? JSON.parse(recsResult.recommendations) : null,
        topCount: recsResult ? recsResult.top_count : null,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      }
    );
  } catch (err) {
    console.error('GetList error:', err);
    return new Response(JSON.stringify({ error: 'Failed to retrieve list' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

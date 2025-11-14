import { nanoid } from 'nanoid';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
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
    // Directly fetch from KV using the hashed key
    try {
      const html = await env.__STATIC_CONTENT.get('index.9e28577481.html');

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
      return new Response(`Error: ${e.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

async function handleUpload(request, env, corsHeaders) {
  try {
    const { animeList, allAnimeIds, stats } = await request.json();

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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleRecommend(request, env, listId, corsHeaders) {
  try {
    const { topCount, recommendations } = await request.json();
    const now = Date.now();

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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetList(request, env, listId, corsHeaders) {
  try {
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Anime Recommendations is a web app that analyzes MyAnimeList exports and generates personalized anime recommendations using collaborative filtering. Users can upload their anime list, get recommendations, and share results via unique URLs.

**Tech Stack:**
- Frontend: Vue 3 (CDN), vanilla JS
- Backend: Cloudflare Workers (worker.js)
- Database: Cloudflare D1 (SQLite)
- External API: Jikan (unofficial MyAnimeList API)

## Development Commands

### Setup
```bash
npm install                  # Install dependencies
npm run db:create           # Create D1 database (first time only)
npm run db:init             # Initialize production database schema
npm run db:local            # Initialize local database schema for development
```

After `db:create`, update the `database_id` in `wrangler.toml` with the ID from the output.

### Development
```bash
npm run dev                 # Run local development server on http://localhost:8787
```

### Deployment
```bash
npm run deploy              # Deploy to Cloudflare Workers
```

## Architecture

**Request Flow:**
```
Browser → Cloudflare Worker → D1 Database
                           → Jikan API (for recommendations)
```

**Core Components:**
- `worker.js`: Cloudflare Worker with API endpoints and static file serving
- `public/index.html`: SPA with Vue 3 frontend
- `schema.sql`: Database schema for user lists and recommendations
- `recommend.py`: Python script for local recommendation testing

**Static File Handling:**
The worker serves `public/index.html` for all non-API routes (SPA routing). Static assets are stored in Workers KV (`__STATIC_CONTENT`) with content-hashed filenames. The worker auto-detects the latest `index.*.html` file by listing keys with the `index.` prefix.

## API Endpoints

### POST /api/upload
Saves user's anime list to database.

**Request:**
```json
{
  "animeList": [{"id": "1", "title": "...", "score": 9}, ...],
  "allAnimeIds": ["1", "2", ...],
  "stats": {...}
}
```

**Response:**
```json
{
  "id": "abc123xyz",
  "url": "https://domain.com/abc123xyz"
}
```

**Validation (worker.js:4-56):**
- animeList must be array with max 1000 entries
- Each anime requires: id, title, score (0-10)
- Title max length: 500 characters
- Payload size limit: 10MB

### POST /api/recommend/:id
Saves recommendations for a user list.

**Request:**
```json
{
  "topCount": 25,
  "recommendations": [{"mal_id": "123", "title": "...", "image": "..."}, ...]
}
```

**Validation (worker.js:38-56):**
- topCount: 1-50
- recommendations: max 100 items
- Payload size limit: 5MB

### GET /api/list/:id
Retrieves saved list and recommendations.

**Response:**
```json
{
  "animeList": [...],
  "allAnimeIds": [...],
  "stats": {...},
  "recommendations": [...],
  "topCount": 25
}
```

**Caching:** 1 hour (`Cache-Control: public, max-age=3600`)

## Database Schema

**user_lists table:**
- `id` (TEXT, PRIMARY KEY): 10-character nanoid
- `anime_list` (TEXT): JSON array of rated anime
- `all_anime_ids` (TEXT): JSON array of all anime IDs for filtering
- `stats` (TEXT): JSON object with user statistics
- `created_at`, `updated_at` (INTEGER): Unix timestamps

**recommendations table:**
- `id` (INTEGER, AUTOINCREMENT)
- `list_id` (TEXT, FOREIGN KEY): References user_lists.id
- `recommendations` (TEXT): JSON array of recommendations with images
- `top_count` (INTEGER): Number of top anime used for recommendations
- `created_at` (INTEGER): Unix timestamp

**Indexes:**
- `idx_list_id` on recommendations(list_id)
- `idx_created_at` on user_lists(created_at)

## Security Considerations

The codebase has input validation and uses parameterized queries to prevent SQL injection. However, note the following:

**Implemented Security:**
- Input validation functions: `validateAnimeList()`, `validateRecommendations()`
- CORS restricted to specific origins (worker.js:64-75)
- Payload size limits on all POST endpoints
- ID format validation with regex patterns
- Sanitized error messages for user-facing responses

**CORS Configuration:**
Allowed origins are:
- https://anime.varyvoda.com
- https://anime-recommendations.cheguevaraua.workers.dev
- http://localhost:8787
- http://localhost:8000

When adding new origins, update the `allowedOrigins` array in worker.js:64-69.

**Rate Limiting:**
Currently not implemented. For production use at scale, consider adding rate limiting using Cloudflare KV or Durable Objects.

## Recommendation Algorithm

The collaborative filtering approach (recommend.py):
1. Parse user's anime list from MAL XML export
2. Extract top-rated anime (score ≥ 8)
3. Fetch recommendations from Jikan API for each top anime
4. Count frequency of recommended titles across all sources
5. Filter out anime already in user's list (using `allAnimeIds`)
6. Return most frequently recommended anime

**Jikan API Rate Limiting:**
- 1 request per second enforced
- Exponential backoff on 429 errors (2s, 4s, 6s)
- Max 3 retries per request

## Common Modifications

**Adding a new API endpoint:**
1. Add route handler in worker.js `fetch()` function
2. Create handler function (e.g., `handleNewEndpoint()`)
3. Add validation function if accepting user input
4. Include CORS headers in response
5. Update this documentation

**Modifying database schema:**
1. Update schema.sql
2. Test locally: `npm run db:local`
3. Deploy to production: `npm run db:init`
4. Note: D1 migrations are manual; consider data migration scripts for existing data

**Updating CORS origins:**
Edit the `allowedOrigins` array in worker.js:64-69.

## Python Script (recommend.py)

For local testing and development. Requires:
```bash
python3 -m venv venv
source venv/bin/activate
# No pip requirements - uses stdlib only
```

**Usage:**
```bash
python3 recommend.py
```

Expects `animelist.xml` in the project root (export from MyAnimeList).

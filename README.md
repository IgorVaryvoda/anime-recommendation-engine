# Anime Recommendations

A web app that analyzes your MyAnimeList export and generates personalized anime recommendations with shareable URLs.

## Features

- 📁 Upload MyAnimeList XML/GZ export
- 🎨 Beautiful UI with anime cover images
- ✨ Collaborative filtering recommendations
- 🔗 Shareable URLs for your recommendations
- 💾 Data stored in Cloudflare D1 database
- ⚡ Deployed on Cloudflare Workers

## Setup

### Prerequisites

- Node.js 18+
- A Cloudflare account
- Wrangler CLI

### Installation

```bash
# Install dependencies
npm install

# Create D1 database
npm run db:create

# Copy the database_id from the output and update wrangler.toml
# Then initialize the database schema
npm run db:init
```

### Development

```bash
# Run local development server with local D1
npm run dev
```

Visit `http://localhost:8787`

### Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## How It Works

1. **Upload**: User uploads their MyAnimeList XML/GZ export
2. **Parse**: App parses anime list and extracts ratings
3. **Save**: Data is saved to Cloudflare D1 with a unique ID
4. **Share**: User gets a shareable URL (e.g., `your-domain.com/abc123`)
5. **Recommend**: App fetches recommendations from Jikan API based on top-rated anime
6. **Cache**: Recommendations are saved to D1 for faster loading

## API Endpoints

- `POST /api/upload` - Save anime list, returns unique ID
- `POST /api/recommend/:id` - Save recommendations for a list
- `GET /api/list/:id` - Retrieve saved list and recommendations

## Tech Stack

- **Frontend**: Vue 3 (CDN), vanilla JS
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **External API**: Jikan (unofficial MyAnimeList API)
- **Deployment**: Cloudflare Pages/Workers

## Architecture

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Cloudflare      │
│ Worker          │
│ (worker.js)     │
└────┬────────┬───┘
     │        │
     ▼        ▼
┌─────────┐ ┌──────────┐
│ D1 DB   │ │ Jikan    │
│         │ │ API      │
└─────────┘ └──────────┘
```

## License

MIT

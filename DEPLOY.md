# Deployment Guide

## Step-by-Step Deployment to Cloudflare

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

This will open a browser window to authenticate.

### 3. Create D1 Database

```bash
npm run db:create
```

You'll see output like:
```
✅ Successfully created DB 'anime-recommendations-db'!

[[d1_databases]]
binding = "DB"
database_name = "anime-recommendations-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 4. Update wrangler.toml

Copy the `database_id` from step 3 and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime-recommendations-db"
database_id = "YOUR-DATABASE-ID-HERE"  # Replace this
```

### 5. Initialize Database Schema

For production:
```bash
npm run db:init
```

For local development:
```bash
npm run db:local
```

### 6. Test Locally

```bash
npm run dev
```

Visit `http://localhost:8787` and test:
- Upload your anime list
- Generate recommendations
- Check that you get a shareable URL

### 7. Deploy to Production

```bash
npm run deploy
```

You'll see output like:
```
✨ Build completed successfully!
✨ Successfully published your Worker
 https://anime-recommendations.your-subdomain.workers.dev
```

### 8. Test Production

1. Visit the deployed URL
2. Upload your anime list
3. Generate recommendations
4. Share the URL with someone to test

### 9. (Optional) Setup Custom Domain

In Cloudflare Dashboard:
1. Go to Workers & Pages
2. Select your worker
3. Click "Settings" → "Domains & Routes"
4. Add custom domain

## Troubleshooting

### Database errors

If you get database errors, make sure you ran the schema initialization:
```bash
wrangler d1 execute anime-recommendations-db --file=./schema.sql
```

### CORS errors

Make sure the worker is returning proper CORS headers (already configured in `worker.js`)

### Assets not loading

Verify that `public/index.html` exists and `wrangler.toml` has the correct assets directory.

## Environment Variables

Currently no environment variables needed! Everything runs on Cloudflare infrastructure.

## Costs

- **D1 Database**: Free tier includes 5GB storage, 5M rows read/day
- **Workers**: Free tier includes 100k requests/day
- **Assets**: Free

For a personal anime recommendation app, you'll likely stay well within free tier limits.

# WatchVault

A polished, personal entertainment tracker with AI-powered sync and personalized recommendations. Track your anime, series, and movies, and let AI tell you when new seasons or sequels drop.

## Features
- **Cinematic Dashboard**: A beautiful full-bleed interface that tracks your watch stats and seamlessly displays your "Continue Watching" items.
- **Media Library**: Track anime, series, and movies with customizable tagging and watch status.
- **Personal Ratings**: Rate anything 1–5 stars. Ratings drive the sort, the rating filter, your average-rating stat, and the AI's taste profile. Click a star again to clear it.
- **Season Tracking**: Granular tracking for watched episodes vs total episodes per season.
- **Smart Deep Sync**: Automatically checks Jikan (Anime) and TMDB (Shows/Movies) for new seasons, episodes, or sequels, automatically updating your watch status.
- **Auto-Metadata Population**: Manually adding an item by title instantly fetches the official poster, global rating, and synopsis in the background.
- **AI Recommendations**: Get personalized recommendations based on what you have liked and completed.
- **Bulk Import**: Paste a plain list of titles, one per line, and every detail — type, year, genre, poster, episode counts — is looked up automatically. Or load a CSV from MyAnimeList, Trakt, IMDb or Letterboxd and map the columns. CSV export too.
- **Bulk Editing**: Select one, many, or all visible titles and change status or remove in one go.
- **Grouping & Filtering**: Group your vault by status, type, genre or rating; filter by any of those plus a free-text search over titles, tags and genres.
- **Light & Dark Mode**: Toggle in the navbar; your choice is remembered.
- **Free Metadata Fallbacks**: Kitsu, iTunes and Wikipedia fill in artwork and details with no API key required, so posters still load when MyAnimeList is down.
- **Optional Cloud Sync**: Share a read-only vault via Turso, gated behind an admin passcode for edits.
- **Privacy-first / API Key Security**: No API keys are stored in localStorage or exposed to the frontend in production.

## Quick Start (Local Development)

1. **Clone the repository**
2. **Create the environment file**
   Create a file at `js/env.js` and paste the following, replacing with your keys:
   ```javascript
   export const ENV_KEYS = {
     geminiKey: "YOUR_GEMINI_KEY",
     groqKey: "YOUR_GROQ_KEY",
     openrouterKey: "",
     cohereKey: "",
     unsplashKey: "YOUR_UNSPLASH_KEY"
   };
   ```
3. **Run a local server**
   ```bash
   npx serve . -p 3000
   ```
   Open `http://localhost:3000` in your browser.

## Deploying to Netlify

WatchVault is built to deploy seamlessly on Netlify with serverless functions for API key security.

1. Connect your GitHub repository to Netlify.
2. Set the following **Environment Variables** in the Netlify Dashboard:
   - `GEMINI_API_KEY` (Required for best results)
   - `GROQ_API_KEY` (Recommended fallback)
   - `OPENROUTER_API_KEY` (Optional fallback)
   - `COHERE_API_KEY` (Optional fallback)
   - `TMDB_API_KEY` (Optional, for season breakdowns and movie data)
   - `UNSPLASH_ACCESS_KEY` (Optional, for higher-quality posters)
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSCODE` (Optional, see Cloud Sync below)
3. Build Settings:
   - Build command: `npm run build-env` or `node build-env.js`
   - Publish directory: `.` (root directory)

## Cloud Sync (Turso) — optional

By default WatchVault stores everything in your browser's `localStorage`. Point it at a
[Turso](https://turso.tech) database and the vault becomes shareable: anyone can **read** it,
but only someone with the admin passcode can **edit**.

1. Create a database and token:
   ```bash
   turso db create watchvault
   turso db show watchvault --url      # → TURSO_DATABASE_URL
   turso db tokens create watchvault   # → TURSO_AUTH_TOKEN
   ```
2. Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `ADMIN_PASSCODE` to your Netlify
   environment variables. The table is created automatically on first use.
3. Open **Settings ⚙️ → Cloud Sync** and enter the passcode to unlock editing. The passcode
   lives in `sessionStorage`, so closing the tab locks it again.

Only text is stored — titles, statuses, seasons, ratings, tags and notes. Poster images are
never written to the database; they're re-fetched locally from the free artwork sources, so
rows stay small. If these variables aren't set, the cloud UI stays hidden and the app works
exactly as before, fully local and fully editable.

## Architecture & Security

This project uses a **Server-Side API Proxy** pattern.
- In **production (Netlify)**, frontend requests go to `/.netlify/functions/ai-proxy`. The Netlify serverless function securely reads environment variables and makes the actual calls to Gemini, Groq, OpenRouter, and Cohere.
- The AI proxy implements a **cascade fallback**: it tries Gemini Flash first, then Gemini Flash Lite, then Groq 70B, Groq 8B, OpenRouter, and finally Cohere Command R.
- In **local development only**, the app falls back to direct API calls using the keys you put in `js/env.js`. That file is gitignored.
- `build-env.js` deliberately writes an **empty** `js/env.js` during the Netlify build. `js/env.js` is served to the browser, so any key written there would be readable by every visitor. Real keys stay in the Netlify environment and are only read server-side by the proxy functions. The browser never falls back to direct keyed calls in production.

## Free API Keys
You can run this project completely for free by getting keys here:
- [Google Gemini API](https://aistudio.google.com/apikey)
- [Groq API](https://console.groq.com/keys)
- [OpenRouter API](https://openrouter.ai/keys)
- [Cohere API](https://dashboard.cohere.com/api-keys)
- [Unsplash API](https://unsplash.com/developers)

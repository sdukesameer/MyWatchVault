# WatchVault

A polished, personal entertainment tracker with AI-powered sync and personalized recommendations. Track your anime, series, and movies, and let AI tell you when new seasons or sequels drop.

## Features
- **Cinematic Dashboard**: A beautiful full-bleed interface that tracks your watch stats and seamlessly displays your "Continue Watching" items.
- **Media Library**: Track anime, series, and movies with customizable tagging and watch status.
- **Season Tracking**: Granular tracking for watched episodes vs total episodes per season.
- **Smart Deep Sync**: Automatically checks Jikan (Anime) and TMDB (Shows/Movies) for new seasons, episodes, or sequels, automatically updating your watch status.
- **Auto-Metadata Population**: Manually adding an item by title instantly fetches the official poster, global rating, and synopsis in the background.
- **AI Recommendations**: Get personalized recommendations based on what you have liked and completed.
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
   - `UNSPLASH_ACCESS_KEY` (Optional, for higher-quality posters)
3. Build Settings:
   - Build command: `npm run build-env` or `node build-env.js`
   - Publish directory: `.` (root directory)

## Architecture & Security

This project uses a **Server-Side API Proxy** pattern.
- In **production (Netlify)**, frontend requests go to `/.netlify/functions/ai-proxy`. The Netlify serverless function securely reads environment variables and makes the actual calls to Gemini, Groq, OpenRouter, and Cohere.
- The AI proxy implements a **cascade fallback**: it tries Gemini Flash first, then Gemini Flash Lite, then Groq 70B, Groq 8B, OpenRouter, and finally Cohere Command R.
- In **local development**, the app falls back to direct API calls using the keys you provide in `js/env.js`. `js/env.js` is gitignored so you don't accidentally commit your keys.

## Free API Keys
You can run this project completely for free by getting keys here:
- [Google Gemini API](https://aistudio.google.com/apikey)
- [Groq API](https://console.groq.com/keys)
- [OpenRouter API](https://openrouter.ai/keys)
- [Cohere API](https://dashboard.cohere.com/api-keys)
- [Unsplash API](https://unsplash.com/developers)

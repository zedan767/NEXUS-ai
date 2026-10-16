# Nexus AI Pro

A polished AI chat starter inspired by modern AI workspaces, with animated styling, a responsive closable sidebar, local conversation history, prompt starters, light/dark theme, a server-side AI API proxy, and optional Google sign-in through Firebase.

## Requirements
- Node.js 18+
- An API key from a provider that supports the OpenAI-compatible `POST /chat/completions` format (or adapt `server.js` for your provider).
- Optional: Firebase project for Google sign-in.

## Setup
1. Extract the ZIP and open a terminal in the project folder.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Edit `.env`:
   - `AI_API_URL`: for Gemini, use `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
   - `AI_API_KEY`: your API key.
   - `AI_MODEL`: for example, `gemini-2.5-flash` (choose a model available to your API key).
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Google login setup
1. Create a project in the Firebase Console.
2. Add a Web App and copy its config values into `.env`.
3. In Authentication → Sign-in method, enable Google.
4. In Authentication → Settings → Authorized domains, add `localhost` for local development and your production domain when deployed.
5. Restart the server. The Google button will use Firebase popup authentication.

Guest mode works without Firebase. Conversation history is stored in the current browser's localStorage; it is not synced between devices or secured as a server-side account history. Firebase authentication is not a substitute for server-side authorization if you later add private server data.

## Security notes
- **Do not put API keys in HTML, browser JavaScript, GitHub, or a public ZIP.** The app sends chat requests to your own Express server, which adds the key server-side.
- The API key pasted into the chat should be treated as exposed. Revoke/rotate it with its provider before using it, then put the replacement only in `.env`.
- `.env` is intentionally not included; only `.env.example` is included.
- Add rate limiting, abuse protection, server-side auth checks, and a privacy policy before deploying publicly.
- The project uses Google's Gemini OpenAI-compatible endpoint by default. See Google's current Gemini API documentation for available models and endpoint details.

## Project structure
```text
nexus-ai-pro/
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── .env.example
├── package.json
├── server.js
└── README.md
```

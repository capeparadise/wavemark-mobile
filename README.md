# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Apple Music Deep Links / MusicKit Setup

To make Apple Music deep links open directly to albums/tracks instead of just launching the app, you need two separate pieces:

1. App side (already done in this repo):
   - `app.json` includes the iOS `LSApplicationQueriesSchemes` for `music`, `musics`, `itmss`, `itms`, `spotify` so we can probe/open those schemes.
   - Code uses canonical `https://music.apple.com/{storefront}/album/...` (or `?i=` for tracks) links.

2. Server side canonical resolution (edge function `apple-resolve`):
   - Deploy the function: `supabase functions deploy apple-resolve --no-verify-jwt`.
   - Set secrets so it can call the Apple Music API (optional but improves accuracy):
     ```bash
     supabase secrets set APPLE_MUSIC_DEV_TOKEN=YOUR_MUSIC_KIT_DEV_TOKEN
     supabase secrets set APPLE_MUSIC_STOREFRONT=us   # or gb, etc.
     ```
   - If you skip the dev token, it falls back to the public iTunes Search API (works, but sometimes less precise).

### Getting a MusicKit (Apple Music) Developer Token

You only need this if you want the edge resolver to use the Apple Music catalog API (better matching):
1. Log into your Apple Developer account.
2. Create an App ID with MusicKit capability (Xcode steps you referenced handle this for native apps; for the token you still need a key).
3. In Certificates, Identifiers & Profiles, create a MusicKit key (or use an existing one) and download the private key file (`.p8`).
4. Use the key ID, team ID, and the private key to generate a JWT developer token (server side). Easiest route is to use a small script or Apple’s example (not included here to avoid secrets in repo).
5. Set that token as `APPLE_MUSIC_DEV_TOKEN` in Supabase secrets.

### After Deploying

1. Remove a problematic listen item (one that previously only launched the Apple Music app home/last page).
2. Add it again via search so the app calls `apple-resolve` and stores the canonical URL.
3. Tap Open. It should now deep link into the specific album/track.

### Optional: Backfill Existing Rows

You can create a maintenance script or UI action that:
1. Fetches all `listen_list` rows missing `apple_url` or having an `itunes.apple.com` host.
2. Calls `apple-resolve` for each.
3. Updates them with the canonical `music.apple.com` URL & ID.

Let me know if you want that backfill wired up.

## Supabase Environment Setup

You must provide your Supabase project credentials for the app to read/write data.

1. Copy `.env.local.example` to `.env.local`.
2. In your Supabase dashboard find:
   - Project URL (https://<project_ref>.supabase.co)
   - anon public key (Settings → API → Project API keys)
3. Paste into `.env.local`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```
4. (Optional) Add a dev email/password to auto sign-in during development:
   ```
   EXPO_PUBLIC_SUPABASE_DEV_EMAIL=you@example.com
   EXPO_PUBLIC_SUPABASE_DEV_PASSWORD=YourPassword123!
   ```
5. Restart Expo: quit the running process then start again.

Verification:
```js
// In console you should see after app start:
[devAuth] signed in as you@example.com
```
If you see warnings about missing keys, re-check the `.env.local` spelling and ensure variables start with `EXPO_PUBLIC_` so Expo exposes them.

Without these keys Apple deep link resolution can't persist canonical URLs and adds fallback mismatch risk.

# Local Firebase Emulators

## Start emulators

```bash
npm run emulators
```

Or:

```bash
firebase emulators:start --only hosting,functions,firestore
```

## Local URLs

| Service   | URL                      |
|----------|---------------------------|
| Hosting  | http://localhost:5000     |
| Emulator UI (Firestore, etc.) | http://localhost:4000 |
| Firestore (emulator) | localhost:8080 (used automatically by the app when running on localhost) |
| Functions (emulator) | localhost:5001 (used by hosting proxy for /api/**) |

## Stop old emulator processes

If you see "port taken" or "multiple instances" errors:

1. Stop any terminal where `firebase emulators:start` is running (Ctrl+C).
2. If ports are still busy, stop old emulator sessions:
   ```bash
   pkill -f firebase
   ```
3. Start again with `npm run emulators`.

## Production

Production is unchanged. Emulator wiring runs only when the app is opened on **localhost** or **127.0.0.1**. The live site always uses real Firebase (Firestore, etc.).

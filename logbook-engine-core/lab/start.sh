#!/bin/bash

# === LOGBOOK ENGINE LAB START SCRIPT ===

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || { echo "❌ Failed to change to script directory"; exit 1; }

echo "📦 Installing dependencies..."
npm install

if [ ! -f ".env" ]; then
  echo "⚠️ .env not found. Creating from example..."
  cp .env.example .env
  echo "👉 IMPORTANT: Open .env and add your GOOGLE_MAPS_API_KEY"
fi

echo "🔍 Checking if port 3000 is in use..."
if lsof -i :3000 >/dev/null 2>&1; then
  echo "⚠️ Port 3000 is busy. Switching to 3001..."
  export PORT=3001
else
  export PORT=3000
fi

echo "🚀 Starting Logbook Engine Lab on port $PORT..."
PORT=$PORT node server.js


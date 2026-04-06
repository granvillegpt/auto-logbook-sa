#!/bin/bash

echo "🧹 Killing all Firebase/emulator processes..."

pkill -9 -f firebase
pkill -9 -f node
pkill -9 -f java

sleep 1

echo "🔍 Verifying ports are free..."

PORTS=(8085 5006 4400 4500 5000 9199)

for PORT in "${PORTS[@]}"
do
  if lsof -i :$PORT > /dev/null
  then
    echo "❌ Port $PORT still in use — killing..."
    PID=$(lsof -ti :$PORT)
    kill -9 $PID
  else
    echo "✅ Port $PORT is free"
  fi
done

sleep 1

echo "🚀 Starting clean emulator (functions + firestore only)..."

firebase emulators:start --only firestore,functions

echo "✅ Done"

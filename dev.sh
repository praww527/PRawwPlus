#!/bin/bash
# Development startup script
# Runs the API server on port 8080 and the Vite frontend on port 5000

set -e

# Kill any existing processes on these ports
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 5000/tcp 2>/dev/null || true

echo "Starting API server on port 8080..."
PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev &
API_PID=$!

echo "Starting frontend on port 5000..."
PORT=5000 API_PORT=8080 pnpm --filter @workspace/prawwplus run dev &
FRONTEND_PID=$!

echo "API PID: $API_PID, Frontend PID: $FRONTEND_PID"

wait $FRONTEND_PID $API_PID

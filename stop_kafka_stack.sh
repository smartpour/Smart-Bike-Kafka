#!/bin/bash

# Smart Bike Kafka Stack Shutdown Script
echo "🛑 Stopping Smart Bike Kafka Infrastructure..."

# Stop Python sensors
if [ -f .hr.pid ]; then
    kill $(cat .hr.pid) 2>/dev/null
    rm .hr.pid
    echo "✅ Stopped heart rate sensor"
fi

if [ -f .cadence.pid ]; then
    kill $(cat .cadence.pid) 2>/dev/null
    rm .cadence.pid
    echo "✅ Stopped cadence sensor"
fi

# Stop backend services
if [ -f .backend.pid ]; then
    kill $(cat .backend.pid) 2>/dev/null
    rm .backend.pid
    echo "✅ Stopped backend service"
fi

# Stop WebSocket bridge
if [ -f .bridge.pid ]; then
    kill $(cat .bridge.pid) 2>/dev/null
    rm .bridge.pid
    echo "✅ Stopped WebSocket bridge"
fi

# Stop Docker containers
echo "🐳 Stopping Kafka containers..."
docker-compose down

echo "🎉 Smart Bike Kafka stack stopped successfully!"

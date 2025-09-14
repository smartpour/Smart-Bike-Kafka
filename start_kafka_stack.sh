#!/bin/bash

# Smart Bike Kafka Stack Startup Script
echo "🚀 Starting Smart Bike Kafka Infrastructure..."

# Start Kafka infrastructure
echo "📊 Starting Kafka cluster..."
docker-compose up -d

# Wait for Kafka to be ready
echo "⏳ Waiting for Kafka to be ready..."
sleep 10

# Start WebSocket bridge
echo "🌉 Starting WebSocket-Kafka bridge..."
cd websocket-kafka-bridge
npm start &
BRIDGE_PID=$!
cd ..

# Start backend services
echo "🔧 Starting backend services..."
cd sensors-backend-kafka
npm start &
BACKEND_PID=$!
cd ..

# Start Python sensors
echo "🔬 Starting sensor drivers..."
cd Drivers/heart_rate_sensor
python heartrate_hybrid.py &
HR_PID=$!
cd ../cadence_sensor
python cadence_kafka.py &
CADENCE_PID=$!
cd ../..

echo "✅ Smart Bike Kafka stack is running!"
echo "📊 Kafka UI: http://localhost:8080"
echo "🌉 WebSocket Bridge: http://localhost:3001"
echo "🔍 Health Check: http://localhost:3001/health"
echo ""
echo "To stop all services, run: ./stop_kafka_stack.sh"

# Save PIDs for cleanup script
echo $BRIDGE_PID > .bridge.pid
echo $BACKEND_PID > .backend.pid
echo $HR_PID > .hr.pid
echo $CADENCE_PID > .cadence.pid

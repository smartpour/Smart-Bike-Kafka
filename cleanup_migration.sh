#!/bin/bash

# Smart Bike Kafka Migration - Cleanup Script
# Removes MQTT dependencies and legacy configurations

echo "🧹 Starting Smart Bike Kafka Migration Cleanup..."

# Remove MQTT-specific packages from Python requirements
echo "📦 Cleaning Python dependencies..."
if [ -f "requirements.txt" ]; then
    # Backup original requirements
    cp requirements.txt requirements.txt.backup

    # Remove MQTT packages
    grep -v "paho-mqtt" requirements.txt > requirements_kafka.txt
    mv requirements_kafka.txt requirements.txt
    echo "✅ Removed MQTT packages from requirements.txt"
fi

# Remove MQTT broker from docker-compose
echo "🐳 Cleaning Docker configurations..."
if [ -f "docker-compose.yml" ]; then
    mv docker-compose.yml docker-compose.mqtt.yml.backup
    echo "✅ Backed up original docker-compose.yml as docker-compose.mqtt.yml.backup"
fi

# Update environment variables
echo "🔧 Updating environment configurations..."
if [ -f ".env" ]; then
    # Backup original .env
    cp .env .env.backup

    # Remove MQTT variables and set Kafka defaults
    sed -i.bak '/MQTT_/d' .env
    echo "" >> .env
    echo "# Kafka Configuration" >> .env
    echo "USE_KAFKA=true" >> .env
    echo "USE_MQTT=false" >> .env
    echo "KAFKA_BROKER=localhost:9092" >> .env
    echo "WEBSOCKET_BRIDGE_URL=http://localhost:3001" >> .env
    echo "✅ Updated environment variables for Kafka-only operation"
fi

# Remove MQTT testing applications
echo "🧪 Cleaning test applications..."
if [ -d "mqtt-testing-application" ]; then
    mv mqtt-testing-application mqtt-testing-application.backup
    echo "✅ Moved MQTT testing app to backup directory"
fi

# Update startup scripts to use only Kafka
echo "📜 Updating startup scripts..."
for script in scripts/start_*.sh; do
    if [ -f "$script" ]; then
        # Replace MQTT calls with Kafka equivalents
        sed -i.bak 's/heartrate\.py/heartrate_hybrid.py/g' "$script"
        sed -i.bak 's/cadence\.py/cadence_kafka.py/g' "$script"
        echo "✅ Updated $script for Kafka usage"
    fi
done

# Remove old MQTT logs
echo "📋 Cleaning log files..."
if [ -f "mqtt.log" ]; then
    mv mqtt.log mqtt.log.backup
    echo "✅ Backed up MQTT log file"
fi

# Update Python sensor files to use Kafka by default
echo "🔬 Updating sensor configurations..."
for sensor_dir in Drivers/heart_rate_sensor Drivers/cadence_sensor; do
    if [ -d "$sensor_dir" ]; then
        cd "$sensor_dir"

        # Update environment variable defaults in Python files
        for py_file in *.py; do
            if [ -f "$py_file" ] && grep -q "USE_KAFKA" "$py_file"; then
                sed -i.bak 's/USE_KAFKA.*=.*False/USE_KAFKA = True/g' "$py_file"
                sed -i.bak 's/USE_MQTT.*=.*True/USE_MQTT = False/g' "$py_file"
                echo "✅ Updated $sensor_dir/$py_file to use Kafka by default"
            fi
        done

        cd - > /dev/null
    fi
done

# Create Kafka-only docker-compose as the default
echo "🏗️ Setting up Kafka-only infrastructure..."
cp docker-compose.kafka.yml docker-compose.yml
echo "✅ Set docker-compose.kafka.yml as default docker-compose.yml"

# Create production startup script
cat > start_kafka_stack.sh << 'EOF'
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
EOF

chmod +x start_kafka_stack.sh

# Create production stop script
cat > stop_kafka_stack.sh << 'EOF'
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
EOF

chmod +x stop_kafka_stack.sh

echo ""
echo "🎉 Smart Bike Kafka Migration Cleanup Complete!"
echo ""
echo "📁 Backup files created:"
echo "  - requirements.txt.backup"
echo "  - .env.backup"
echo "  - docker-compose.mqtt.yml.backup"
echo "  - mqtt-testing-application.backup/"
echo "  - mqtt.log.backup"
echo ""
echo "🚀 Production scripts created:"
echo "  - start_kafka_stack.sh - Start all Kafka services"
echo "  - stop_kafka_stack.sh  - Stop all Kafka services"
echo ""
echo "▶️  To start the Kafka stack: ./start_kafka_stack.sh"
echo "⏹️  To stop the Kafka stack:  ./stop_kafka_stack.sh"

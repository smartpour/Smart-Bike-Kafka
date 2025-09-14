#!/bin/bash

# Start Heart Rate Sensor with Kafka support
# Usage: ./start_heartrate_kafka.sh

# Set environment variables
export DEVICE_ID=${DEVICE_ID:-"000001"}
export USE_KAFKA=${USE_KAFKA:-"true"}
export USE_MQTT=${USE_MQTT:-"false"}
export KAFKA_BOOTSTRAP_SERVERS=${KAFKA_BOOTSTRAP_SERVERS:-"localhost:9092"}
export HEART_RATE_DEVICE_PREFIX=${HEART_RATE_DEVICE_PREFIX:-"TICKR"}

echo "Starting Heart Rate Sensor (Kafka-enabled)"
echo "Device ID: $DEVICE_ID"
echo "Kafka: $USE_KAFKA"
echo "MQTT: $USE_MQTT"
echo "Bootstrap Servers: $KAFKA_BOOTSTRAP_SERVERS"
echo "Device Prefix: $HEART_RATE_DEVICE_PREFIX"

cd "$(dirname "$0")/.."

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Start the heart rate sensor
python3 Drivers/heart_rate_sensor/heartrate_hybrid.py

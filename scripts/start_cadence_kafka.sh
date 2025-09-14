#!/bin/bash

# Start Cadence Sensor with Kafka support
# Usage: ./start_cadence_kafka.sh

# Set environment variables
export DEVICE_ID=${DEVICE_ID:-"000001"}
export USE_KAFKA=${USE_KAFKA:-"true"}
export USE_MQTT=${USE_MQTT:-"false"}
export KAFKA_BOOTSTRAP_SERVERS=${KAFKA_BOOTSTRAP_SERVERS:-"localhost:9092"}
export CADENCE_DEVICE_PREFIX=${CADENCE_DEVICE_PREFIX:-"RPM"}

echo "Starting Cadence Sensor (Kafka-enabled)"
echo "Device ID: $DEVICE_ID"
echo "Kafka: $USE_KAFKA"
echo "MQTT: $USE_MQTT"
echo "Bootstrap Servers: $KAFKA_BOOTSTRAP_SERVERS"
echo "Device Prefix: $CADENCE_DEVICE_PREFIX"

cd "$(dirname "$0")/.."

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Start the cadence sensor
python3 Drivers/cadence_sensor/cadence_kafka.py

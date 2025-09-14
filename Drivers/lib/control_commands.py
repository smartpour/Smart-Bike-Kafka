#!/usr/bin/env python3
import sys
import os

# Add the lib directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))

from kafka_client import KafkaClient, KafkaTopics
from mqtt_client import MQTTClient
import json
import time

class ControlCommandPublisher:
    """
    Utility class for publishing control commands to both Kafka and MQTT
    during the migration period.
    """

    def __init__(self, device_id, use_kafka=True, use_mqtt=False):
        self.device_id = device_id
        self.use_kafka = use_kafka
        self.use_mqtt = use_mqtt
        self.kafka_client = None
        self.mqtt_client = None

        if self.use_kafka:
            self.setup_kafka_client()

        if self.use_mqtt:
            self.setup_mqtt_client()

    def setup_kafka_client(self):
        """Setup Kafka client for publishing control commands"""
        kafka_bootstrap_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self.kafka_client = KafkaClient(
            bootstrap_servers=kafka_bootstrap_servers,
            client_id=f"control_publisher_{self.device_id}"
        )
        self.kafka_client.setup_kafka_client()
        print(f"Kafka client initialized: {kafka_bootstrap_servers}")

    def setup_mqtt_client(self):
        """Setup MQTT client for publishing control commands"""
        mqtt_hostname = os.getenv('MQTT_HOSTNAME')
        mqtt_username = os.getenv('MQTT_USERNAME')
        mqtt_password = os.getenv('MQTT_PASSWORD')

        if mqtt_hostname and mqtt_username and mqtt_password:
            self.mqtt_client = MQTTClient(mqtt_hostname, mqtt_username, mqtt_password)
            self.mqtt_client.setup_mqtt_client()
            print(f"MQTT client initialized: {mqtt_hostname}")
        else:
            print("MQTT credentials not provided, skipping MQTT setup")
            self.use_mqtt = False

    def publish_fan_control(self, speed):
        """
        Publish fan control command
        Args:
            speed (int): Fan speed 0-100
        """
        if speed < 0 or speed > 100:
            raise ValueError("Fan speed must be between 0 and 100")

        payload = {
            "value": speed,
            "unitName": "percent",
            "timestamp": time.time(),
            "command": "set_fan_speed"
        }

        # Publish to Kafka
        if self.use_kafka and self.kafka_client:
            kafka_topic = KafkaTopics.control_topic(self.device_id, "fan")
            print(f"Publishing fan control to Kafka: {kafka_topic} {payload}")
            self.kafka_client.publish(kafka_topic, payload)

        # Publish to MQTT (legacy format)
        if self.use_mqtt and self.mqtt_client:
            mqtt_topic = f"bike/{self.device_id}/fan/control"
            print(f"Publishing fan control to MQTT: {mqtt_topic} {speed}")
            self.mqtt_client.publish(mqtt_topic, str(speed))

    def publish_resistance_control(self, resistance):
        """
        Publish resistance control command
        Args:
            resistance (int): Resistance level (range depends on device)
        """
        payload = {
            "value": resistance,
            "unitName": "level",
            "timestamp": time.time(),
            "command": "set_resistance"
        }

        # Publish to Kafka
        if self.use_kafka and self.kafka_client:
            kafka_topic = KafkaTopics.control_topic(self.device_id, "resistance")
            print(f"Publishing resistance control to Kafka: {kafka_topic} {payload}")
            self.kafka_client.publish(kafka_topic, payload)

        # Publish to MQTT (legacy format)
        if self.use_mqtt and self.mqtt_client:
            mqtt_topic = f"bike/{self.device_id}/resistance/control"
            print(f"Publishing resistance control to MQTT: {mqtt_topic} {resistance}")
            self.mqtt_client.publish(mqtt_topic, str(resistance))

    def publish_incline_control(self, incline):
        """
        Publish incline control command
        Args:
            incline (int): Incline percentage (can be negative for decline)
        """
        payload = {
            "value": incline,
            "unitName": "percent",
            "timestamp": time.time(),
            "command": "set_incline"
        }

        # Publish to Kafka
        if self.use_kafka and self.kafka_client:
            kafka_topic = KafkaTopics.control_topic(self.device_id, "incline")
            print(f"Publishing incline control to Kafka: {kafka_topic} {payload}")
            self.kafka_client.publish(kafka_topic, payload)

        # Publish to MQTT (legacy format)
        if self.use_mqtt and self.mqtt_client:
            mqtt_topic = f"bike/{self.device_id}/incline/control"
            print(f"Publishing incline control to MQTT: {mqtt_topic} {incline}")
            self.mqtt_client.publish(mqtt_topic, str(incline))

def main():
    """Command line interface for testing control commands"""
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <command_type> <value>")
        print("command_type: fan, resistance, incline")
        print("value: numeric value for the command")
        print("Examples:")
        print(f"  {sys.argv[0]} fan 50        # Set fan to 50%")
        print(f"  {sys.argv[0]} resistance 5  # Set resistance to level 5")
        print(f"  {sys.argv[0]} incline -2    # Set incline to -2%")
        exit(1)

    command_type = sys.argv[1].lower()
    value = int(sys.argv[2])

    device_id = os.getenv('DEVICE_ID', '000001')
    use_kafka = os.getenv('USE_KAFKA', 'true').lower() == 'true'
    use_mqtt = os.getenv('USE_MQTT', 'false').lower() == 'true'

    publisher = ControlCommandPublisher(device_id, use_kafka, use_mqtt)

    try:
        if command_type == 'fan':
            publisher.publish_fan_control(value)
        elif command_type == 'resistance':
            publisher.publish_resistance_control(value)
        elif command_type == 'incline':
            publisher.publish_incline_control(value)
        else:
            print(f"Unknown command type: {command_type}")
            exit(1)

        print("Command published successfully")

    except Exception as e:
        print(f"Error publishing command: {e}")
        exit(1)

if __name__ == "__main__":
    main()

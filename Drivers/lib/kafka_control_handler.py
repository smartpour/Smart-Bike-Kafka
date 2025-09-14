#!/usr/bin/env python3

import re
import os
import sys
import json
import threading

root_folder = os.path.abspath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(root_folder)

from lib.kafka_client import KafkaClient, KafkaTopics
from lib.mqtt_client import MQTTClient
from lib.constants import RESISTANCE_MIN, RESISTANCE_MAX, INCLINE_MIN, INCLINE_MAX

class KafkaControlCommandHandler:
    """
    Kafka-based control command handler that replaces MQTTClientWithSendingFTMSCommands
    """

    def __init__(self, device, device_id, use_kafka=True, use_mqtt=False):
        self.device = device
        self.device_id = device_id
        self.use_kafka = use_kafka
        self.use_mqtt = use_mqtt
        self.kafka_client = None
        self.mqtt_client = None
        self.running = False

        if self.use_kafka:
            self.setup_kafka_client()

        if self.use_mqtt:
            self.setup_mqtt_client()

    def setup_kafka_client(self):
        """Setup Kafka client for consuming control commands"""
        kafka_bootstrap_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self.kafka_client = KafkaClient(
            bootstrap_servers=kafka_bootstrap_servers,
            client_id=f"control_handler_{self.device_id}"
        )

        # Subscribe to control topics
        control_topics = [
            KafkaTopics.control_topic(self.device_id, "resistance"),
            KafkaTopics.control_topic(self.device_id, "incline"),
            KafkaTopics.control_topic(self.device_id, "fan")
        ]

        self.kafka_client.setup_consumer(control_topics, f"control_group_{self.device_id}")
        print(f"Kafka control handler initialized for topics: {control_topics}")

    def setup_mqtt_client(self):
        """Setup MQTT client for consuming control commands (backward compatibility)"""
        mqtt_hostname = os.getenv('MQTT_HOSTNAME')
        mqtt_username = os.getenv('MQTT_USERNAME')
        mqtt_password = os.getenv('MQTT_PASSWORD')

        if mqtt_hostname and mqtt_username and mqtt_password:
            self.mqtt_client = MQTTClient(mqtt_hostname, mqtt_username, mqtt_password)
            self.mqtt_client.setup_mqtt_client()

            # Subscribe to MQTT control topics
            self.mqtt_client.subscribe(f"bike/{self.device_id}/resistance/control")
            self.mqtt_client.subscribe(f"bike/{self.device_id}/incline/control")
            self.mqtt_client.subscribe(f"bike/{self.device_id}/fan/control")

            # Override the on_message callback
            self.mqtt_client.on_message = self.on_mqtt_message
            print(f"MQTT control handler initialized: {mqtt_hostname}")

    def start_consuming(self):
        """Start consuming control commands"""
        self.running = True

        if self.use_kafka and self.kafka_client:
            kafka_thread = threading.Thread(target=self._kafka_consumer_loop, daemon=True)
            kafka_thread.start()

        if self.use_mqtt and self.mqtt_client:
            self.mqtt_client.loop_start()

        print("Control command handler started")

    def stop_consuming(self):
        """Stop consuming control commands"""
        self.running = False

        if self.kafka_client:
            self.kafka_client.stop()

        if self.mqtt_client:
            self.mqtt_client.client.loop_stop()

    def _kafka_consumer_loop(self):
        """Kafka consumer loop for control commands"""
        try:
            for message in self.kafka_client.consumer:
                if not self.running:
                    break

                self.on_kafka_message(message.topic, message.value)
        except Exception as e:
            print(f"Error in Kafka consumer loop: {e}")

    def on_kafka_message(self, topic, payload):
        """Handle Kafka control command messages"""
        try:
            print(f"[Kafka control command received] Topic: {topic}, Payload: {payload}")

            # Extract control type from topic (e.g., bike.000001.resistance.control -> resistance)
            topic_parts = topic.split('.')
            if len(topic_parts) >= 3:
                control_type = topic_parts[2]

                if isinstance(payload, dict):
                    value = payload.get('value')
                    command = payload.get('command')
                else:
                    # Handle legacy numeric values
                    value = int(payload) if str(payload).isdigit() else payload

                self.execute_control_command(control_type, value)
            else:
                print(f"Invalid topic format: {topic}")

        except Exception as e:
            print(f"Error processing Kafka message: {e}")

    def on_mqtt_message(self, client, userdata, msg):
        """Handle MQTT control command messages (backward compatibility)"""
        try:
            value = str(msg.payload, 'utf-8')
            print(f"[MQTT control command received] Topic: {msg.topic}, Value: {value}")

            # Extract control type from topic
            if "/resistance" in msg.topic.lower():
                control_type = "resistance"
            elif "/incline" in msg.topic.lower():
                control_type = "incline"
            elif "/fan" in msg.topic.lower():
                control_type = "fan"
            else:
                print(f"Unknown MQTT control topic: {msg.topic}")
                return

            if re.match(r"[-+]?\d+$", value):
                int_value = int(value)
                self.execute_control_command(control_type, int_value)
            else:
                print(f"Invalid MQTT command payload: {value}")

        except Exception as e:
            print(f"Error processing MQTT message: {e}")

    def execute_control_command(self, control_type, value):
        """Execute the actual control command"""
        try:
            if control_type == "incline":
                if value > INCLINE_MAX or value < INCLINE_MIN:
                    message = f"Skip invalid incline value: {value} (range: {INCLINE_MIN}% - {INCLINE_MAX}%)"
                    print(message)
                    self.publish_report("incline", message)
                else:
                    print(f"Setting incline to {value}%")
                    if hasattr(self.device, 'custom_control_point_set_target_inclination'):
                        self.device.custom_control_point_set_target_inclination(value)
                    self.publish_report("incline", f"Incline set to {value}%")

            elif control_type == "resistance":
                if value > RESISTANCE_MAX or value < RESISTANCE_MIN:
                    message = f"Skip invalid resistance value: {value} (range: {RESISTANCE_MIN} - {RESISTANCE_MAX})"
                    print(message)
                    self.publish_report("resistance", message)
                else:
                    print(f"Setting resistance to {value}")
                    if hasattr(self.device, 'ftms_set_target_resistance_level'):
                        self.device.ftms_set_target_resistance_level(value)
                    self.publish_report("resistance", f"Resistance set to {value}")

            elif control_type == "fan":
                if value > 100 or value < 0:
                    message = f"Skip invalid fan value: {value} (range: 0 - 100)"
                    print(message)
                    self.publish_report("fan", message)
                else:
                    print(f"Setting fan to {value}%")
                    # Fan control implementation would go here
                    self.publish_report("fan", f"Fan set to {value}%")

            else:
                print(f"Unknown control type: {control_type}")

        except Exception as e:
            print(f"Error executing control command: {e}")
            self.publish_report(control_type, f"Error: {str(e)}")

    def publish_report(self, control_type, message):
        """Publish control command report/status"""
        payload = {
            "message": message,
            "timestamp": time.time(),
            "deviceId": self.device_id
        }

        # Publish to Kafka
        if self.use_kafka and self.kafka_client:
            kafka_topic = KafkaTopics.report_topic(self.device_id, control_type)
            self.kafka_client.publish(kafka_topic, payload)

        # Publish to MQTT (legacy)
        if self.use_mqtt and self.mqtt_client:
            mqtt_topic = f"bike/{self.device_id}/{control_type}/report"
            self.mqtt_client.publish(mqtt_topic, message)

# Legacy compatibility class
class MQTTClientWithSendingFTMSCommands(MQTTClient):
    """
    Hybrid MQTT client that can also handle Kafka commands
    This maintains backward compatibility while adding Kafka support
    """

    def __init__(self, broker_address, username, password, device):
        super().__init__(broker_address, username, password)
        self.device = device

        # Setup Kafka handler
        device_id = os.getenv('DEVICE_ID', '000001')
        use_kafka = os.getenv('USE_KAFKA', 'true').lower() == 'true'
        use_mqtt = True  # Keep MQTT enabled for this hybrid approach

        self.kafka_handler = KafkaControlCommandHandler(device, device_id, use_kafka, use_mqtt)

    def setup_mqtt_client(self):
        """Override to also start Kafka consumer"""
        super().setup_mqtt_client()
        self.kafka_handler.start_consuming()

    def on_message(self, client, userdata, msg):
        """Handle MQTT messages using the new handler"""
        self.kafka_handler.on_mqtt_message(client, userdata, msg)

if __name__ == "__main__":
    # Test the control command handler
    class MockDevice:
        def ftms_set_target_resistance_level(self, value):
            print(f"Mock: Setting resistance to {value}")

        def custom_control_point_set_target_inclination(self, value):
            print(f"Mock: Setting incline to {value}")

    device = MockDevice()
    handler = KafkaControlCommandHandler(device, "000001", use_kafka=True, use_mqtt=False)
    handler.start_consuming()

    print("Control command handler test started. Press Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        handler.stop_consuming()
        print("Control command handler stopped")

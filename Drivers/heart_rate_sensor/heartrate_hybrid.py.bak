#!/usr/bin/env python3
import gatt
import sys
import os

# Add the lib directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))

from kafka_client import KafkaClient, KafkaTopics
from mqtt_client import MQTTClient
import time
import platform
import json

# Global variables for both MQTT and Kafka clients
kafka_client = None
mqtt_client = None
deviceId = None
use_kafka = True  # Flag to enable/disable Kafka publishing
use_mqtt = True   # Flag to enable/disable MQTT publishing (for backward compatibility)

# Subclass gatt.DeviceManager to allow discovery only of TICKR devices
class AnyDeviceManager(gatt.DeviceManager):
    def device_discovered(self, device):
        alias = device.alias()
        if alias is not None and self.prefix is not None and len(alias) >= len(self.prefix) and alias[0:len(self.prefix)] == self.prefix:
            device = AnyDevice(mac_address=device.mac_address, manager=self)
            device.connect()
            device.zero_limit = 10
            device.zeroCount = 0

# Subclass gatt.Device to implement the Heart Rate Protocol
class AnyDevice(gatt.Device):
    def connect_succeeded(self):
        super().connect_succeeded()
        print("[%s] Connected" % (self.mac_address))

    def connect_failed(self, error):
        super().connect_failed(error)
        print("[%s] Connection failed: %s" % (self.mac_address, str(error)))

    def disconnect_succeeded(self):
        super().disconnect_succeeded()

    def services_resolved(self):
        super().services_resolved()
        self.start_measurements()

    def start_measurements(self):
        print("Starting heart rate measurements")

        device_information_service = next(
            s for s in self.services
            if s.uuid == "0000180d-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a37-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement.enable_notifications()

    def stop_measurements(self):
        device_information_service = next(
            s for s in self.services
            if s.uuid == "0000180d-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a37-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement.disable_notifications()

    def characteristic_value_updated(self, characteristic, value):
        heartrate = value[1]
        if heartrate == 0:
            self.zeroCount += 1
            if self.zeroCount == self.zero_limit:
                self.zeroCount = 0
                print("too many zeros in the heart rate - disconnecting")
                self.disconnect()
                time.sleep(5)
        else:
            self.zeroCount = 0
            ts = time.time()
            print(f"Heart rate: {heartrate} bpm at {ts}")
            self.publish(ts, heartrate)

    def publish(self, ts, heartrate):
        payload = self.data_report_payload(heartrate, ts)

        # Publish to Kafka (new system)
        if use_kafka and kafka_client:
            kafka_topic = KafkaTopics.device_topic(deviceId, "heartrate")
            print(f"Publishing to Kafka: {kafka_topic} {payload}")
            try:
                kafka_client.publish(kafka_topic, payload)
            except Exception as e:
                print(f"Failed to publish to Kafka: {e}")

        # Publish to MQTT (legacy system - for backward compatibility)
        if use_mqtt and mqtt_client:
            mqtt_topic = f"bike/{deviceId}/heartrate"
            print(f"Publishing to MQTT: {mqtt_topic} {payload}")
            try:
                mqtt_client.publish(mqtt_topic, json.dumps(payload))
            except Exception as e:
                print(f"Failed to publish to MQTT: {e}")

    def data_report_payload(self, value, timestamp):
        return {
            "value": value,
            "unitName": 'BPM',
            "timestamp": timestamp,
            "metadata": {"deviceName": platform.node()}
        }

def main():
    global kafka_client, mqtt_client, deviceId, use_kafka, use_mqtt

    try:
        # Load environment variables
        deviceId = os.getenv('DEVICE_ID', '000001')
        use_kafka = os.getenv('USE_KAFKA', 'true').lower() == 'true'
        use_mqtt = os.getenv('USE_MQTT', 'false').lower() == 'true'

        print(f"Device ID: {deviceId}")
        print(f"Kafka enabled: {use_kafka}")
        print(f"MQTT enabled: {use_mqtt}")

        # Setup Kafka client if enabled
        if use_kafka:
            kafka_bootstrap_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
            kafka_client = KafkaClient(
                bootstrap_servers=kafka_bootstrap_servers,
                client_id=f"heart_rate_sensor_{deviceId}"
            )
            kafka_client.setup_kafka_client()
            print(f"Kafka client initialized: {kafka_bootstrap_servers}")

        # Setup MQTT client if enabled (for backward compatibility)
        if use_mqtt:
            mqtt_hostname = os.getenv('MQTT_HOSTNAME')
            mqtt_username = os.getenv('MQTT_USERNAME')
            mqtt_password = os.getenv('MQTT_PASSWORD')

            if mqtt_hostname and mqtt_username and mqtt_password:
                mqtt_client = MQTTClient(mqtt_hostname, mqtt_username, mqtt_password)
                mqtt_client.setup_mqtt_client()
                print(f"MQTT client initialized: {mqtt_hostname}")
            else:
                print("MQTT credentials not provided, skipping MQTT setup")
                use_mqtt = False

        # Start heart rate sensor discovery
        dm = AnyDeviceManager(adapter_name='hci0')
        dm.prefix = os.getenv('HEART_RATE_DEVICE_PREFIX', 'TICKR')
        print(f"Looking for devices with prefix: {dm.prefix}")

        dm.start_discovery()
        dm.run()

    except Exception as e:
        print(f"Error in heart rate sensor: {e}")
        raise

if __name__ == '__main__':
    main()

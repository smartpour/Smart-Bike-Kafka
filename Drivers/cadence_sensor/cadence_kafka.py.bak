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

# Global variables
kafka_client = None
mqtt_client = None
deviceId = None
use_kafka = True
use_mqtt = True
old_crank_revolutions = 0
old_crank_event_time = 0

# Subclass gatt.DeviceManager to allow discovery only of cadence devices
class AnyDeviceManager(gatt.DeviceManager):
    def device_discovered(self, device):
        alias = device.alias()
        if alias is not None and self.prefix is not None and len(alias) >= len(self.prefix) and alias[0:len(self.prefix)] == self.prefix:
            print("[%s] Discovered, alias = %s" % (device.mac_address, device.alias()))
            device = AnyDevice(mac_address=device.mac_address, manager=self)
            device.connect()

# Subclass gatt.Device to implement the Cadence Protocol
class AnyDevice(gatt.Device):
    def __del__(self):
        self.stop_measurements()
        self.manager.stop_discovery()

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
        print("Starting cadence measurements")

        # CSC = Cycling Speed and Cadence
        device_information_service = next(
            s for s in self.services
            if s.uuid == "00001816-0000-1000-8000-00805f9b34fb")

        cadence_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a5b-0000-1000-8000-00805f9b34fb")

        cadence_measurement.enable_notifications()

    def stop_measurements(self):
        device_information_service = next(
            s for s in self.services
            if s.uuid == "00001816-0000-1000-8000-00805f9b34fb")

        cadence_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a5b-0000-1000-8000-00805f9b34fb")

        cadence_measurement.disable_notifications()

    def characteristic_value_updated(self, characteristic, value):
        ts = time.time()

        print(value)

        # Parse cadence data from the characteristic value
        try:
            bin_value = bin(value[0])
            little_endian = value.hex()
            conversion = bytearray.fromhex(little_endian)
            conversion.reverse()
            big_endian = conversion.hex()

            global old_crank_revolutions, old_crank_event_time

            if (int(bin_value[2]) == 1):
                print("crank data present")

                crank_data = big_endian[:-2]
                crank_event_time = big_endian[0:4]
                crank_revolutions = big_endian[4:8]

                crank_event_time = int(crank_event_time, 16)
                crank_revolutions = int(crank_revolutions, 16)

                print(f"crank event time: {crank_event_time}, crank revolutions: {crank_revolutions}")

                if old_crank_revolutions != 0 and old_crank_event_time != 0:
                    revolution_diff = crank_revolutions - old_crank_revolutions
                    time_diff = crank_event_time - old_crank_event_time

                    if time_diff > 0:
                        cadence = (revolution_diff * 60 * 1024) / time_diff
                        print(f"Cadence: {cadence} RPM at {ts}")
                        self.publish(ts, cadence)

                old_crank_revolutions = crank_revolutions
                old_crank_event_time = crank_event_time
            else:
                print("No crank data present")
                self.publish(ts, 0)

        except Exception as e:
            print(f"Error parsing cadence data: {e}")
            self.publish(ts, 0)

    def publish(self, ts, cadence):
        payload = self.data_report_payload(cadence, ts)

        # Publish to Kafka (new system)
        if use_kafka and kafka_client:
            kafka_topic = KafkaTopics.device_topic(deviceId, "cadence")
            print(f"Publishing to Kafka: {kafka_topic} {payload}")
            try:
                kafka_client.publish(kafka_topic, payload)
            except Exception as e:
                print(f"Failed to publish to Kafka: {e}")

        # Publish to MQTT (legacy system)
        if use_mqtt and mqtt_client:
            mqtt_topic = f"bike/{deviceId}/cadence"
            print(f"Publishing to MQTT: {mqtt_topic} {payload}")
            try:
                mqtt_client.publish(mqtt_topic, json.dumps(payload))
            except Exception as e:
                print(f"Failed to publish to MQTT: {e}")

    def data_report_payload(self, value, timestamp):
        return {
            "value": value,
            "unitName": 'RPM',
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
                client_id=f"cadence_sensor_{deviceId}"
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

        # Start cadence sensor discovery
        dm = AnyDeviceManager(adapter_name='hci0')
        dm.prefix = os.getenv('CADENCE_DEVICE_PREFIX', 'RPM')
        print(f"Looking for devices with prefix: {dm.prefix}")

        dm.start_discovery()
        dm.run()

    except Exception as e:
        print(f"Error in cadence sensor: {e}")
        raise

if __name__ == '__main__':
    main()

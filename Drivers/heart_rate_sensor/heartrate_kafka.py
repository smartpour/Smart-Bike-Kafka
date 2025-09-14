#!/usr/bin/env python3
import gatt
from lib.kafka_client import KafkaClient, KafkaTopics
import os
import time
import platform
import json

# Subclass gatt.DeviceManager to allow discovery only of TICKR devices
# When the alias begins with the required prefix, connect to the device
class AnyDeviceManager(gatt.DeviceManager):
    def device_discovered(self, device):
        alias = device.alias()
        if alias is not None and self.prefix is not None and len(alias) >= len(self.prefix) and alias[0:len(self.prefix)] == self.prefix:
            #print("[%s] Discovered, alias = %s" % (device.mac_address, device.alias()))
            device = AnyDevice(mac_address=device.mac_address, manager=self)
            device.connect()
            device.zero_limit = 10
            device.zeroCount = 0

# Subclass gatt.Device to implement the Heart Rate Protocol
class AnyDevice(gatt.Device):
    # When the program exits, stop measurements and discovery services
    #def __del__(self):
        #self.stop_measurements()
        #self.manager.stop_discovery()

    # Called when the connection succeeds
    def connect_succeeded(self):
        super().connect_succeeded()
        print("[%s] Connected" % (self.mac_address))


    # Called when the connection fails
    # Display an error message on the console
    def connect_failed(self, error):
        super().connect_failed(error)
        print("[%s] Connection failed: %s" % (self.mac_address, str(error)))


    # Called with disconnection succeeds
    def disconnect_succeeded(self):
        super().disconnect_succeeded()
        #print("[%s] Disconnected" % (self.mac_address))


    # Called once the services offered by the bluetooth device have been resolved
    # They can now be used, so start measurements
    def services_resolved(self):
        super().services_resolved()
        self.start_measurements()


    # Start listening for heart rate measurements
    def start_measurements(self):
        print("Starting heart rate measurements")

        # If the device doesn't have the expected service/characteristic,
        # ignore it and disconnect
        device_information_service = next(
            s for s in self.services
            if s.uuid == "0000180d-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a37-0000-1000-8000-00805f9b34fb")

        # Listen for notifications and print the results
        heart_rate_measurement.enable_notifications()
        # heart_rate_measurement.write_value(bytearray([0x01, 0x00]));


    # Stop listening for heart rate measurements
    def stop_measurements(self):
        device_information_service = next(
            s for s in self.services
            if s.uuid == "0000180d-0000-1000-8000-00805f9b34fb")

        heart_rate_measurement = next(
            c for c in device_information_service.characteristics
            if c.uuid == "00002a37-0000-1000-8000-00805f9b34fb")

        # Stop listening for notifications
        heart_rate_measurement.disable_notifications()


    # Called with all incoming heart rate measurements
    def characteristic_value_updated(self, characteristic, value):
        heartrate = value[1]
        if heartrate == 0:
            self.zeroCount += 1
            if self.zeroCount == self.zero_limit:
                self.zeroCount = 0
                print("too many zeros in the heart rate - disconnecting")
                self.disconnect()
                time.sleep(5) # don't immediately try to reconnect
        else:
            self.zeroCount = 0
            ts = time.time()
            print(f"Heart rate: {heartrate} bpm at {ts}")
            self.publish(ts, heartrate)

    # Publish the heart rate to Kafka
    def publish(self, ts, heartrate):
        topic = KafkaTopics.device_topic(deviceId, "heartrate")
        payload = self.kafka_data_report_payload(heartrate, ts)
        print(f"Publishing {topic} {payload}")
        kafka_client.publish(topic, payload)

    def kafka_data_report_payload(self, value, timestamp):
        return {
            "value": value,
            "unitName": 'BPM',
            "timestamp": timestamp,
            "metadata": {"deviceName": platform.node()}
        }

def main():
    try:
        # setup the global variables
        global kafka_client
        global deviceId
        kafka_client = KafkaClient(
            bootstrap_servers=os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092'),
            client_id=f"heart_rate_sensor_{os.getenv('DEVICE_ID', '000001')}"
        )
        kafka_client.setup_kafka_client()
        deviceId = os.getenv('DEVICE_ID', '000001')

        print(f"Kafka client initialized for device: {deviceId}")
        print(f"Bootstrap servers: {os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')}")

        # Add a prefix filter to only connect to TICKR devices
        dm = AnyDeviceManager(adapter_name='hci0')
        dm.prefix = os.getenv('HEART_RATE_DEVICE_PREFIX', 'TICKR')
        print(f"Looking for devices with prefix: {dm.prefix}")

        # Start discovery and run the event loop
        dm.start_discovery()
        dm.run()

    except Exception as e:
        print(f"Error: {e}")
        raise

if __name__ == '__main__':
    main()

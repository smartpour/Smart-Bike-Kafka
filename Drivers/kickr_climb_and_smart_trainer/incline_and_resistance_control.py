#!/usr/bin/env python3

import os
import sys
import gatt
from argparse import ArgumentParser
from wahoo_device import WahooDevice
 
root_folder = os.path.abspath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(root_folder)

from lib.constants import BIKE_01_INCLINE_COMMAND, BIKE_01_RESISTANCE_COMMAND, BIKE_01_INCLINE_REPORT, BIKE_01_RESISTANCE_REPORT, BIKE_01_SPEED_REPORT, BIKE_01_CADENCE_REPORT, BIKE_01_POWER_REPORT

# define CLI parse arguments
parser = ArgumentParser(description="Wahoo Kickr Incline and Resistance Control")

# BLE connection params
parser.add_argument('--mac_address', dest='mac_address', type=str, help="The Wahoo Kickr BLE Device's unique mac address")

# HiveMQ connection params
parser.add_argument('--broker_address', dest='broker_address', type=str, help='The MQTT broker address getting from HiveMQ Cloud')
parser.add_argument('--username', dest='username', type=str, help='HiveMQ Cloud username')
parser.add_argument('--password', dest='password', type=str, help='HiveMQ Cloud password')

parser.add_argument('--incline_command_topic', dest='incline_command_topic', type=str, help='a MQTT topic that will send incline or resistance control commands to this driver', default=BIKE_01_INCLINE_COMMAND)
parser.add_argument('--incline_report_topic', dest='incline_report_topic', type=str, help='a MQTT topic that will receieve the current incline or resistance levels data from this driver', default=BIKE_01_INCLINE_REPORT)
parser.add_argument('--resistance_command_topic', dest='resistance_command_topic', type=str, help='a MQTT topic that will send incline or resistance control commands to this driver', default=BIKE_01_RESISTANCE_COMMAND)
parser.add_argument('--resistance_report_topic', dest='resistance_report_topic', type=str, help='a MQTT topic that will receieve the current incline or resistance levels data from this driver', default=BIKE_01_RESISTANCE_REPORT)
parser.add_argument('--speed_report_topic', dest='speed_report_topic', type=str, help='a MQTT topic that will receive the current instantaneous speed data in m/s from this driver', default=BIKE_01_SPEED_REPORT)
parser.add_argument('--cadence_report_topic', dest='cadence_report_topic', type=str, help='a MQTT topic that will receive the current instantaneous cadence data in rpm from this driver', default=BIKE_01_CADENCE_REPORT)
parser.add_argument('--power_report_topic', dest='power_report_topic', type=str, help='a MQTT topic that will receive the current instantaneous power data in W from this driver', default=BIKE_01_POWER_REPORT)

args = parser.parse_args()

print("Connecting to the BLE device...")
manager = gatt.DeviceManager(adapter_name='hci0')

# initiate and connect a WahooDevice with a given BLE mac_address
device = WahooDevice(manager=manager, mac_address=args.mac_address, args=args)
device.connect()

try:
    print("Running the device manager now...")
    # run the device manager in the main thread forever
    manager.run()
except KeyboardInterrupt:
    print ('Exit the program.')
    manager.stop()
    sys.exit(0)

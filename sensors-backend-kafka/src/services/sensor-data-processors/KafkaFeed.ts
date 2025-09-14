import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment';
import { Kafka, EachMessagePayload } from 'kafkajs';
import {
  deviceDataModel,
  IMQTTDeviceData,
  IDeviceData,
} from '../../models/device-data';
import { DeviceType } from '../../models/device';

dotenv.config();

// Interface for Kafka device data payload (similar to MQTT but for Kafka)
interface IKafkaDeviceData {
  bikeId?: any;
  deviceId?: any;
  workoutId?: any;
  userId?: any;
  deviceName?: string;
  bikeName?: string;
  unitName: string;
  value: number;
  metadata?: object;
  reportedAt?: Date;
  timestamp?: number; // Unix timestamp for Kafka messages
}

// Initialize Kafka client
const kafka = new Kafka({
  clientId: 'sensor-data-processor',
  brokers: [process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'sensor-data-group' });

// Device type mapping from Kafka topics
const DEVICE_TYPE_MAP: Record<string, DeviceType> = {
  heartrate: DeviceType.heartRate,
  cadence: DeviceType.cadence,
  speed: DeviceType.speed,
  power: DeviceType.power,
  resistance: DeviceType.resistance,
  incline: DeviceType.incline,
  fan: DeviceType.fan,
};

// Function to extract device info from Kafka topic
function parseKafkaTopic(
  topic: string
): { deviceId: string; deviceType: DeviceType } | null {
  // Expected format: bike.{deviceId}.{deviceType}
  const topicParts = topic.split('.');

  if (topicParts.length >= 3 && topicParts[0] === 'bike') {
    const deviceId = topicParts[1];
    const deviceType = DEVICE_TYPE_MAP[topicParts[2]];

    if (deviceType) {
      return { deviceId, deviceType };
    }
  }

  return null;
}

// Function to save device data to MongoDB
async function saveDeviceData(
  deviceData: IKafkaDeviceData,
  deviceId: string,
  deviceType: DeviceType
) {
  try {
    const newDeviceData = new deviceDataModel({
      value: Number(deviceData.value),
      unitName: deviceData.unitName,
      timestamp: deviceData.timestamp
        ? new Date(deviceData.timestamp * 1000)
        : new Date(),
      deviceType: deviceType,
      deviceId: deviceId,
      metadata: deviceData.metadata || {},
      bikeName: deviceData.bikeName || deviceId, // Use deviceId as fallback for bikeName
      reportedAt: deviceData.reportedAt
        ? new Date(deviceData.reportedAt)
        : new Date(),
    });

    await newDeviceData.save();
    console.log(`✅ Saved ${deviceType} data for device ${deviceId}:`, {
      value: newDeviceData.value,
      unitName: newDeviceData.unitName,
      timestamp: newDeviceData.timestamp,
    });
  } catch (error) {
    console.error(
      `❌ Failed to save ${deviceType} data for device ${deviceId}:`,
      error
    );
  }
}

// Main Kafka consumer function
const run = async () => {
  console.log('🚀 Starting Kafka sensor data processor...');

  try {
    // Connect to Kafka
    await consumer.connect();
    console.log('✅ Connected to Kafka broker');

    // Subscribe to sensor data topics using pattern matching
    await consumer.subscribe({
      topics: [
        'bike.000001.heartrate',
        'bike.000001.cadence',
        'bike.000001.speed',
        'bike.000001.power',
        'bike.000001.resistance',
        'bike.000001.incline',
        'bike.000001.fan',
      ],
    });
    console.log('✅ Subscribed to sensor data topics');

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({
        topic,
        partition,
        message,
      }: EachMessagePayload) => {
        try {
          // Parse the message
          const messageValue = message.value?.toString();
          if (!messageValue) {
            console.warn(`⚠️ Empty message received from topic ${topic}`);
            return;
          }

          console.log(`📨 [${topic}] Received message:`, messageValue);

          // Parse device info from topic
          const topicInfo = parseKafkaTopic(topic);
          if (!topicInfo) {
            console.warn(`⚠️ Unidentified topic format: ${topic}`);
            return;
          }

          const { deviceId, deviceType } = topicInfo;

          // Parse JSON payload
          let deviceData: IKafkaDeviceData;
          try {
            deviceData = JSON.parse(messageValue);
          } catch (parseError) {
            console.error(
              `❌ Failed to parse JSON from topic ${topic}:`,
              parseError
            );
            return;
          }

          // Validate required fields
          if (deviceData.value === undefined || deviceData.value === null) {
            console.warn(`⚠️ Missing value in message from topic ${topic}`);
            return;
          }

          // Save to database
          await saveDeviceData(deviceData, deviceId, deviceType);
        } catch (error) {
          console.error(
            `❌ Error processing message from topic ${topic}:`,
            error
          );
        }
      },
    });
  } catch (error) {
    console.error('❌ Error in Kafka consumer:', error);
    process.exit(1);
  }
};

// Graceful shutdown handling
const shutdown = async () => {
  console.log('\n🛑 Shutting down Kafka consumer...');
  try {
    await consumer.disconnect();
    console.log('✅ Kafka consumer disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/smart-bike')
  .then(() => {
    console.log('✅ Connected to MongoDB!');
    // Start Kafka consumer after MongoDB connection is established
    run().catch(console.error);
  })
  .catch((error: any) => {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  });

export default consumer;

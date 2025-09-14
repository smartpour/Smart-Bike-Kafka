import { io, Socket } from 'socket.io-client';

interface SensorData {
  topic: string;
  deviceId: string;
  deviceType: string;
  isReport: boolean;
  data: {
    value: number;
    unitName: string;
    timestamp: number;
    metadata?: any;
  };
  timestamp: string;
}

interface ControlCommand {
  deviceId: string;
  controlType: 'fan' | 'resistance' | 'incline';
  value: number;
  command: string;
}

class KafkaWebSocketClient {
  private socket: Socket | null = null;
  private baseUrl: string;
  private isConnected: boolean = false;
  private subscriptions: Map<string, (data: SensorData) => void> = new Map();

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.baseUrl, {
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        });

        this.socket.on('connect', () => {
          console.log('✅ Connected to WebSocket-Kafka bridge');
          this.isConnected = true;
          resolve();
        });

        this.socket.on('disconnect', () => {
          console.log('❌ Disconnected from WebSocket-Kafka bridge');
          this.isConnected = false;
        });

        this.socket.on('error', (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        });

        this.socket.on('sensor_data', (data: SensorData) => {
          const key = `${data.deviceId}_${data.deviceType}`;
          const callback = this.subscriptions.get(key);
          if (callback) {
            callback(data);
          }
        });

        this.socket.on('control_published', (data) => {
          console.log('Control command published:', data);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  subscribe(deviceId: string, deviceTypes: string[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to WebSocket bridge'));
        return;
      }

      this.socket.emit('subscribe', { deviceId, deviceTypes });

      this.socket.once('subscribed', (data) => {
        console.log('✅ Subscribed to:', data);
        resolve();
      });

      // Set timeout for subscription
      setTimeout(() => {
        reject(new Error('Subscription timeout'));
      }, 5000);
    });
  }

  onSensorData(
    deviceId: string,
    deviceType: string,
    callback: (data: SensorData) => void
  ): void {
    const key = `${deviceId}_${deviceType}`;
    this.subscriptions.set(key, callback);
  }

  publishControl(command: ControlCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to WebSocket bridge'));
        return;
      }

      this.socket.emit('publish_control', command);

      this.socket.once('control_published', () => {
        resolve();
      });

      this.socket.once('error', (error) => {
        reject(error);
      });

      // Set timeout for control command
      setTimeout(() => {
        reject(new Error('Control command timeout'));
      }, 5000);
    });
  }

  // Server-Sent Events alternative for browsers that don't support WebSockets
  connectSSE(): EventSource {
    const eventSource = new EventSource(`${this.baseUrl}/events`);

    eventSource.onopen = () => {
      console.log('✅ Connected to SSE stream');
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: SensorData = JSON.parse(event.data);
        const key = `${data.deviceId}_${data.deviceType}`;
        const callback = this.subscriptions.get(key);
        if (callback) {
          callback(data);
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    return eventSource;
  }

  // Health check
  async healthCheck(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return await response.json();
    } catch (error) {
      console.error('Health check failed:', error);
      throw error;
    }
  }
}

// Legacy MQTT-compatible interface for easy migration
export class KafkaClientAdapter {
  private kafkaClient: KafkaWebSocketClient;
  private messageCallbacks: Map<
    string,
    (topic: string, message: Buffer) => void
  > = new Map();

  constructor(baseUrl?: string) {
    this.kafkaClient = new KafkaWebSocketClient(baseUrl);
  }

  // MQTT-compatible connect method
  async connect(): Promise<void> {
    await this.kafkaClient.connect();
  }

  // MQTT-compatible subscribe method
  async subscribe(topic: string): Promise<void> {
    // Convert MQTT topic format to Kafka subscription
    const topicParts = topic.split('/');
    if (topicParts.length >= 3 && topicParts[0] === 'bike') {
      const deviceId = topicParts[1];
      const deviceType = topicParts[2];

      await this.kafkaClient.subscribe(deviceId, [deviceType]);

      this.kafkaClient.onSensorData(deviceId, deviceType, (data) => {
        // Convert to MQTT-like format
        const mqttTopic = `bike/${data.deviceId}/${data.deviceType}`;
        const message = Buffer.from(JSON.stringify(data.data));

        const callback = this.messageCallbacks.get(mqttTopic);
        if (callback) {
          callback(mqttTopic, message);
        }
      });
    }
  }

  // MQTT-compatible message handler
  on(
    event: 'message',
    callback: (topic: string, message: Buffer) => void
  ): void {
    if (event === 'message') {
      // Store the callback for when messages arrive
      this.messageCallbacks.set('default', callback);
    }
  }

  // MQTT-compatible publish method
  async publish(topic: string, message: string | Buffer): Promise<void> {
    const topicParts = topic.split('/');
    if (
      topicParts.length >= 4 &&
      topicParts[0] === 'bike' &&
      topicParts[3] === 'control'
    ) {
      const deviceId = topicParts[1];
      const controlType = topicParts[2] as 'fan' | 'resistance' | 'incline';
      const value = parseInt(message.toString());

      await this.kafkaClient.publishControl({
        deviceId,
        controlType,
        value,
        command: `set_${controlType}`,
      });
    }
  }

  disconnect(): void {
    this.kafkaClient.disconnect();
  }
}

export default KafkaWebSocketClient;

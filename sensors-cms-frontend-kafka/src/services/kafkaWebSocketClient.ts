/**
 * Kafka WebSocket Client for Real-time Sensor Data
 * Provides MQTT-like API for easy migration from MQTT frontend
 */

import { io, Socket } from 'socket.io-client';

export interface SensorData {
  timestamp: Date;
  value: any;
  deviceId: string;
  sensorType: string;
}

export interface KafkaMessage {
  topic: string;
  partition: number;
  offset: string;
  value: any;
  timestamp: string;
}

export class KafkaWebSocketClient {
  private socket: Socket | null = null;
  private eventSource: EventSource | null = null;
  private subscribers: Map<string, ((data: SensorData) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private useSSE = false;

  constructor(
    private bridgeUrl: string = 'http://localhost:3001',
    private options: {
      useSSE?: boolean;
      autoReconnect?: boolean;
      reconnectDelay?: number;
      maxReconnectAttempts?: number;
    } = {}
  ) {
    this.useSSE = options.useSSE || false;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
  }

  /**
   * Connect to the WebSocket-Kafka bridge
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.useSSE) {
        this.connectSSE(resolve, reject);
      } else {
        this.connectWebSocket(resolve, reject);
      }
    });
  }

  private connectWebSocket(resolve: () => void, reject: (error: Error) => void) {
    this.socket = io(this.bridgeUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });

    this.socket.on('connect', () => {
      console.log('✅ Connected to WebSocket-Kafka bridge');
      this.reconnectAttempts = 0;
      resolve();
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from WebSocket-Kafka bridge');
      if (this.options.autoReconnect) {
        this.handleReconnect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error);
      reject(new Error(`Failed to connect: ${error.message}`));
    });

    this.socket.on('kafka-message', (message: KafkaMessage) => {
      this.handleKafkaMessage(message);
    });

    this.socket.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  }

  private connectSSE(resolve: () => void, reject: (error: Error) => void) {
    this.eventSource = new EventSource(`${this.bridgeUrl}/events`);

    this.eventSource.onopen = () => {
      console.log('✅ Connected to SSE-Kafka bridge');
      this.reconnectAttempts = 0;
      resolve();
    };

    this.eventSource.onerror = (error) => {
      console.error('❌ SSE connection error:', error);
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        if (this.options.autoReconnect) {
          this.handleReconnect();
        }
      }
      reject(new Error('Failed to connect to SSE endpoint'));
    };

    this.eventSource.onmessage = (event) => {
      try {
        const message: KafkaMessage = JSON.parse(event.data);
        this.handleKafkaMessage(message);
      } catch (error) {
        console.error('❌ Error parsing SSE message:', error);
      }
    };
  }

  private handleKafkaMessage(message: KafkaMessage) {
    // Parse topic to extract sensor type and device ID
    const topicParts = message.topic.split('.');
    if (topicParts.length >= 3) {
      const deviceId = topicParts[1];
      const sensorType = topicParts[2];
      
      const sensorData: SensorData = {
        timestamp: new Date(message.timestamp),
        value: message.value,
        deviceId,
        sensorType
      };

      // Notify subscribers for this specific topic
      const topicSubscribers = this.subscribers.get(message.topic) || [];
      topicSubscribers.forEach(callback => callback(sensorData));

      // Notify subscribers for sensor type (e.g., 'heartrate')
      const typeSubscribers = this.subscribers.get(sensorType) || [];
      typeSubscribers.forEach(callback => callback(sensorData));

      // Notify subscribers for all messages
      const allSubscribers = this.subscribers.get('*') || [];
      allSubscribers.forEach(callback => callback(sensorData));
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('❌ Reconnection failed:', error);
      });
    }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)); // Exponential backoff
  }

  /**
   * Subscribe to sensor data updates
   * @param topic - Kafka topic, sensor type, or '*' for all messages
   * @param callback - Function to call when data is received
   */
  subscribe(topic: string, callback: (data: SensorData) => void): void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    this.subscribers.get(topic)!.push(callback);

    // If using WebSocket, tell the server about our subscription
    if (this.socket?.connected) {
      this.socket.emit('subscribe', { topic });
    }
  }

  /**
   * Unsubscribe from sensor data updates
   */
  unsubscribe(topic: string, callback?: (data: SensorData) => void): void {
    const subscribers = this.subscribers.get(topic);
    if (!subscribers) return;

    if (callback) {
      const index = subscribers.indexOf(callback);
      if (index > -1) {
        subscribers.splice(index, 1);
      }
    } else {
      // Remove all subscribers for this topic
      this.subscribers.delete(topic);
    }

    // If using WebSocket, tell the server about our unsubscription
    if (this.socket?.connected) {
      this.socket.emit('unsubscribe', { topic });
    }
  }

  /**
   * Publish control commands (for fan, resistance, incline)
   */
  async publish(topic: string, data: any): Promise<void> {
    if (this.socket?.connected) {
      return new Promise((resolve, reject) => {
        this.socket!.emit('publish', { topic, data }, (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve();
          }
        });
      });
    } else {
      throw new Error('Not connected to WebSocket bridge');
    }
  }

  /**
   * Disconnect from the bridge
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.subscribers.clear();
    console.log('✅ Disconnected from Kafka bridge');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (this.useSSE) {
      return this.eventSource?.readyState === EventSource.OPEN;
    }
    return this.socket?.connected || false;
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: boolean;
    transport: 'websocket' | 'sse';
    reconnectAttempts: number;
    subscribers: number;
  } {
    return {
      connected: this.isConnected(),
      transport: this.useSSE ? 'sse' : 'websocket',
      reconnectAttempts: this.reconnectAttempts,
      subscribers: Array.from(this.subscribers.values()).reduce((total, subs) => total + subs.length, 0)
    };
  }
}

// MQTT-compatible adapter for easy migration
export class MQTTCompatibleAdapter {
  private kafkaClient: KafkaWebSocketClient;

  constructor(bridgeUrl?: string) {
    this.kafkaClient = new KafkaWebSocketClient(bridgeUrl, {
      autoReconnect: true,
      useSSE: false
    });
  }

  async connect(): Promise<void> {
    return this.kafkaClient.connect();
  }

  // MQTT-like subscribe method
  subscribe(topic: string, callback: (topic: string, message: Buffer) => void): void {
    this.kafkaClient.subscribe(topic, (data: SensorData) => {
      // Convert to MQTT-like format
      const message = Buffer.from(JSON.stringify(data.value));
      const mqttTopic = `bike/${data.deviceId}/${data.sensorType}`;
      callback(mqttTopic, message);
    });
  }

  // MQTT-like publish method
  async publish(topic: string, message: string | Buffer): Promise<void> {
    const data = typeof message === 'string' ? message : message.toString();
    return this.kafkaClient.publish(topic, JSON.parse(data));
  }

  disconnect(): void {
    this.kafkaClient.disconnect();
  }
}

export default KafkaWebSocketClient;

/**
 * Example React component using the Kafka WebSocket client
 * Shows real-time sensor data from Smart Bike
 */

import React, { useState, useEffect, useCallback } from 'react';
import KafkaWebSocketClient, {
  SensorData,
  MQTTCompatibleAdapter,
} from '../services/kafkaWebSocketClient';

interface SensorReading {
  heartrate?: number;
  cadence?: number;
  speed?: number;
  power?: number;
  resistance?: number;
  incline?: number;
  fan?: number;
  timestamp: Date;
}

const SmartBikeDashboard: React.FC = () => {
  const [kafkaClient] = useState(
    () =>
      new KafkaWebSocketClient('http://localhost:3001', {
        autoReconnect: true,
        useSSE: false,
      })
  );

  const [isConnected, setIsConnected] = useState(false);
  const [sensorData, setSensorData] = useState<SensorReading>({
    timestamp: new Date(),
  });
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  // Control states
  const [fanSpeed, setFanSpeed] = useState(0);
  const [resistance, setResistance] = useState(1);
  const [incline, setIncline] = useState(0);

  const updateSensorReading = useCallback((data: SensorData) => {
    setSensorData((prev) => ({
      ...prev,
      [data.sensorType]: data.value,
      timestamp: data.timestamp,
    }));
  }, []);

  useEffect(() => {
    const connectToKafka = async () => {
      try {
        setConnectionStatus('Connecting...');
        await kafkaClient.connect();
        setIsConnected(true);
        setConnectionStatus('Connected');

        // Subscribe to all sensor types
        kafkaClient.subscribe('heartrate', updateSensorReading);
        kafkaClient.subscribe('cadence', updateSensorReading);
        kafkaClient.subscribe('speed', updateSensorReading);
        kafkaClient.subscribe('power', updateSensorReading);
        kafkaClient.subscribe('resistance', updateSensorReading);
        kafkaClient.subscribe('incline', updateSensorReading);
        kafkaClient.subscribe('fan', updateSensorReading);

        console.log('✅ Subscribed to all sensor topics');
      } catch (error) {
        console.error('❌ Failed to connect to Kafka bridge:', error);
        setConnectionStatus(`Error: ${error.message}`);
      }
    };

    connectToKafka();

    return () => {
      kafkaClient.disconnect();
    };
  }, [kafkaClient, updateSensorReading]);

  const handleFanControl = async (speed: number) => {
    try {
      await kafkaClient.publish('bike.000001.fan.command', { speed });
      setFanSpeed(speed);
      console.log(`✅ Fan speed set to ${speed}`);
    } catch (error) {
      console.error('❌ Failed to control fan:', error);
    }
  };

  const handleResistanceControl = async (level: number) => {
    try {
      await kafkaClient.publish('bike.000001.resistance.command', { level });
      setResistance(level);
      console.log(`✅ Resistance set to ${level}`);
    } catch (error) {
      console.error('❌ Failed to control resistance:', error);
    }
  };

  const handleInclineControl = async (angle: number) => {
    try {
      await kafkaClient.publish('bike.000001.incline.command', { angle });
      setIncline(angle);
      console.log(`✅ Incline set to ${angle}°`);
    } catch (error) {
      console.error('❌ Failed to control incline:', error);
    }
  };

  return (
    <div className='smart-bike-dashboard'>
      <h1>Smart Bike Dashboard (Kafka)</h1>

      {/* Connection Status */}
      <div
        className={`connection-status ${
          isConnected ? 'connected' : 'disconnected'
        }`}
      >
        <h3>Connection: {connectionStatus}</h3>
        <p>
          Status:{' '}
          {kafkaClient.getStatus().connected ? '🟢 Online' : '🔴 Offline'}
        </p>
        <p>Transport: {kafkaClient.getStatus().transport}</p>
        <p>Subscribers: {kafkaClient.getStatus().subscribers}</p>
      </div>

      {/* Sensor Readings */}
      <div className='sensor-grid'>
        <div className='sensor-card'>
          <h3>❤️ Heart Rate</h3>
          <p className='sensor-value'>{sensorData.heartrate || '--'} bpm</p>
        </div>

        <div className='sensor-card'>
          <h3>🚴 Cadence</h3>
          <p className='sensor-value'>{sensorData.cadence || '--'} rpm</p>
        </div>

        <div className='sensor-card'>
          <h3>🏃 Speed</h3>
          <p className='sensor-value'>{sensorData.speed || '--'} km/h</p>
        </div>

        <div className='sensor-card'>
          <h3>⚡ Power</h3>
          <p className='sensor-value'>{sensorData.power || '--'} watts</p>
        </div>

        <div className='sensor-card'>
          <h3>🔧 Resistance</h3>
          <p className='sensor-value'>{sensorData.resistance || '--'}</p>
        </div>

        <div className='sensor-card'>
          <h3>📐 Incline</h3>
          <p className='sensor-value'>{sensorData.incline || '--'}°</p>
        </div>

        <div className='sensor-card'>
          <h3>💨 Fan</h3>
          <p className='sensor-value'>{sensorData.fan || '--'} %</p>
        </div>
      </div>

      {/* Controls */}
      <div className='controls-section'>
        <h3>Bike Controls</h3>

        <div className='control-group'>
          <label>Fan Speed: {fanSpeed}%</label>
          <input
            type='range'
            min='0'
            max='100'
            value={fanSpeed}
            onChange={(e) => handleFanControl(Number(e.target.value))}
            disabled={!isConnected}
          />
        </div>

        <div className='control-group'>
          <label>Resistance Level: {resistance}</label>
          <input
            type='range'
            min='1'
            max='20'
            value={resistance}
            onChange={(e) => handleResistanceControl(Number(e.target.value))}
            disabled={!isConnected}
          />
        </div>

        <div className='control-group'>
          <label>Incline: {incline}°</label>
          <input
            type='range'
            min='-10'
            max='20'
            value={incline}
            onChange={(e) => handleInclineControl(Number(e.target.value))}
            disabled={!isConnected}
          />
        </div>
      </div>

      <div className='timestamp'>
        Last Update: {sensorData.timestamp.toLocaleTimeString()}
      </div>
    </div>
  );
};

// Example using MQTT-compatible adapter for easy migration
export const MQTTCompatibleDashboard: React.FC = () => {
  const [mqttClient] = useState(
    () => new MQTTCompatibleAdapter('http://localhost:3001')
  );
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const connectAndSubscribe = async () => {
      try {
        await mqttClient.connect();

        // Subscribe using MQTT-like API
        mqttClient.subscribe('heartrate', (topic, message) => {
          const data = JSON.parse(message.toString());
          setMessages((prev) => [
            ...prev.slice(-9),
            `${topic}: ${JSON.stringify(data)}`,
          ]);
        });

        mqttClient.subscribe('cadence', (topic, message) => {
          const data = JSON.parse(message.toString());
          setMessages((prev) => [
            ...prev.slice(-9),
            `${topic}: ${JSON.stringify(data)}`,
          ]);
        });
      } catch (error) {
        console.error('❌ MQTT adapter connection failed:', error);
      }
    };

    connectAndSubscribe();

    return () => {
      mqttClient.disconnect();
    };
  }, [mqttClient]);

  return (
    <div className='mqtt-compatible-dashboard'>
      <h2>MQTT-Compatible Interface</h2>
      <div className='message-log'>
        {messages.map((msg, index) => (
          <div key={index} className='message'>
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartBikeDashboard;

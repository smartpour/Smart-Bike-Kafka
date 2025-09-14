"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv = __importStar(require("dotenv"));
const kafkajs_1 = require("kafkajs");
dotenv.config();
// Initialize Express app
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
// Configure CORS for Socket.IO
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
    }
});
// Enable CORS for Express
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
}));
app.use(express_1.default.json());
// Initialize Kafka client
const kafka = new kafkajs_1.Kafka({
    clientId: 'websocket-kafka-bridge',
    brokers: [process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092']
});
const consumer = kafka.consumer({ groupId: 'websocket-bridge-group' });
const producer = kafka.producer();
// Device type mapping
const DEVICE_TYPES = ['heartrate', 'cadence', 'speed', 'power', 'resistance', 'incline', 'fan'];
// Store active WebSocket connections
const activeConnections = new Map();
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        connections: activeConnections.size
    });
});
// Server-Sent Events endpoint for real-time data
app.get('/events', (req, res) => {
    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || "http://localhost:3000",
        'Access-Control-Allow-Credentials': 'true'
    });
    // Send initial connection message
    res.write('data: {"type":"connected","message":"SSE connection established"}\n\n');
    // Store connection
    const connectionId = `sse_${Date.now()}`;
    activeConnections.set(connectionId, res);
    // Handle client disconnect
    req.on('close', () => {
        activeConnections.delete(connectionId);
        console.log(`SSE client disconnected: ${connectionId}`);
    });
    console.log(`SSE client connected: ${connectionId}`);
});
// WebSocket connection handling
io.on('connection', (socket) => {
    console.log(`WebSocket client connected: ${socket.id}`);
    // Store WebSocket connection
    activeConnections.set(socket.id, socket);
    // Handle device subscription
    socket.on('subscribe', (data) => {
        const { deviceId, deviceTypes = DEVICE_TYPES } = data;
        console.log(`Client ${socket.id} subscribing to device ${deviceId} for types: ${deviceTypes.join(', ')}`);
        // Join rooms for specific device and types
        deviceTypes.forEach(type => {
            const room = `device_${deviceId}_${type}`;
            socket.join(room);
        });
        socket.emit('subscribed', { deviceId, deviceTypes });
    });
    // Handle control command publishing
    socket.on('publish_control', async (data) => {
        try {
            const topic = `bike.${data.deviceId}.${data.controlType}.control`;
            const payload = {
                value: data.value,
                unitName: getUnitForControlType(data.controlType),
                timestamp: Date.now() / 1000,
                command: data.command
            };
            await producer.send({
                topic,
                messages: [{ value: JSON.stringify(payload) }]
            });
            console.log(`Published control command: ${topic}`, payload);
            socket.emit('control_published', { topic, payload });
        }
        catch (error) {
            console.error('Error publishing control command:', error);
            socket.emit('error', { message: 'Failed to publish control command' });
        }
    });
    // Handle client disconnect
    socket.on('disconnect', () => {
        console.log(`WebSocket client disconnected: ${socket.id}`);
        activeConnections.delete(socket.id);
    });
});
// Kafka consumer to forward messages to WebSocket clients
const startKafkaConsumer = async () => {
    try {
        await consumer.connect();
        console.log('✅ Kafka consumer connected');
        // Subscribe to all sensor data topics
        const topics = [];
        for (const deviceId of ['000001']) { // Add more device IDs as needed
            for (const type of DEVICE_TYPES) {
                topics.push(`bike.${deviceId}.${type}`);
                topics.push(`bike.${deviceId}.${type}.report`);
            }
        }
        await consumer.subscribe({ topics });
        console.log('✅ Subscribed to Kafka topics:', topics);
        await consumer.run({
            eachMessage: async ({ topic, message }) => {
                try {
                    const data = JSON.parse(message.value?.toString() || '{}');
                    // Extract device info from topic
                    const topicParts = topic.split('.');
                    if (topicParts.length >= 3) {
                        const deviceId = topicParts[1];
                        const deviceType = topicParts[2];
                        const isReport = topicParts[3] === 'report';
                        const messageData = {
                            topic,
                            deviceId,
                            deviceType,
                            isReport,
                            data,
                            timestamp: new Date().toISOString()
                        };
                        // Send to WebSocket clients in relevant rooms
                        const room = `device_${deviceId}_${deviceType}`;
                        io.to(room).emit('sensor_data', messageData);
                        // Send to SSE clients
                        const sseMessage = `data: ${JSON.stringify(messageData)}\n\n`;
                        activeConnections.forEach((connection, id) => {
                            if (id.startsWith('sse_')) {
                                try {
                                    connection.write(sseMessage);
                                }
                                catch (error) {
                                    console.error(`Error sending SSE message to ${id}:`, error);
                                    activeConnections.delete(id);
                                }
                            }
                        });
                        console.log(`📡 Forwarded ${topic} to ${activeConnections.size} clients`);
                    }
                }
                catch (error) {
                    console.error('Error processing Kafka message:', error);
                }
            }
        });
    }
    catch (error) {
        console.error('❌ Error starting Kafka consumer:', error);
        process.exit(1);
    }
};
// Initialize Kafka producer
const startKafkaProducer = async () => {
    try {
        await producer.connect();
        console.log('✅ Kafka producer connected');
    }
    catch (error) {
        console.error('❌ Error starting Kafka producer:', error);
        process.exit(1);
    }
};
// Helper function to get unit for control type
function getUnitForControlType(controlType) {
    switch (controlType) {
        case 'fan':
        case 'incline':
            return 'percent';
        case 'resistance':
            return 'level';
        default:
            return 'unit';
    }
}
// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('\n🛑 Shutting down WebSocket-Kafka bridge...');
    try {
        // Close WebSocket connections
        io.close();
        // Close Kafka connections
        await consumer.disconnect();
        await producer.disconnect();
        // Close HTTP server
        server.close(() => {
            console.log('✅ Server shut down gracefully');
            process.exit(0);
        });
    }
    catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
// Start the server
const PORT = process.env.PORT || 3001;
const startServer = async () => {
    // Initialize Kafka connections
    await startKafkaProducer();
    await startKafkaConsumer();
    // Start HTTP server
    server.listen(PORT, () => {
        console.log(`🚀 WebSocket-Kafka Bridge running on port ${PORT}`);
        console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
        console.log(`📊 SSE endpoint: http://localhost:${PORT}/events`);
        console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    });
};
startServer().catch(console.error);
exports.default = app;
//# sourceMappingURL=server.js.map
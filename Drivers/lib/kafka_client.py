#!/usr/bin/env python3

import sys
import time
import json
import logging
from kafka import KafkaProducer, KafkaConsumer
from kafka.errors import KafkaError
import threading

# Setup logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

logger_formatter = logging.Formatter('%(levelname)s:%(name)s:%(message)s')

logger_file_handler = logging.FileHandler('kafka.log')
logger_file_handler.setFormatter(logger_formatter)

logger_stream_handler = logging.StreamHandler()

logger.addHandler(logger_file_handler)
logger.addHandler(logger_stream_handler)

# Log unhandled exceptions
def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    logger.critical("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

sys.excepthook = handle_exception

class KafkaClient:
    """
    Kafka client that can publish to and consume from Kafka topics.
    Designed to be a drop-in replacement for MQTTClient.
    """

    def __init__(self, bootstrap_servers, client_id=None):
        self.bootstrap_servers = bootstrap_servers
        self.client_id = client_id or "smart-bike-client"
        self.producer = None
        self.consumer = None
        self.consumer_thread = None
        self.message_callbacks = {}
        self.running = False

    def get_client(self):
        return self

    def setup_kafka_client(self):
        """Initialize Kafka producer - equivalent to setup_mqtt_client"""
        try:
            self.producer = KafkaProducer(
                bootstrap_servers=self.bootstrap_servers,
                client_id=self.client_id,
                value_serializer=lambda v: json.dumps(v).encode('utf-8') if isinstance(v, dict) else str(v).encode('utf-8'),
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                acks='all',  # Wait for all replicas to acknowledge
                retries=3,
                retry_backoff_ms=100
            )
            logger.info(f"Kafka producer initialized with bootstrap servers: {self.bootstrap_servers}")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka producer: {e}")
            raise

    def setup_consumer(self, topics, group_id):
        """Setup Kafka consumer for specified topics"""
        try:
            self.consumer = KafkaConsumer(
                *topics,
                bootstrap_servers=self.bootstrap_servers,
                group_id=group_id,
                client_id=self.client_id,
                value_deserializer=lambda v: self._deserialize_value(v),
                key_deserializer=lambda k: k.decode('utf-8') if k else None,
                auto_offset_reset='latest',
                enable_auto_commit=True
            )
            logger.info(f"Kafka consumer initialized for topics: {topics} with group_id: {group_id}")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka consumer: {e}")
            raise

    def _deserialize_value(self, value):
        """Deserialize message value, handling both JSON and plain text"""
        try:
            decoded = value.decode('utf-8')
            return json.loads(decoded)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return decoded if 'decoded' in locals() else value.decode('utf-8', errors='ignore')

    def subscribe(self, topic_name, callback=None):
        """Subscribe to a topic - equivalent to MQTT subscribe"""
        if callback:
            self.message_callbacks[topic_name] = callback

        if not self.consumer:
            # Setup consumer with single topic for now
            self.setup_consumer([topic_name], f"{self.client_id}_group")
        else:
            # Subscribe to additional topic
            self.consumer.subscribe([topic_name])

        logger.info(f"Subscribed to topic: {topic_name}")

    def publish(self, topic_name, payload):
        """Publish a message to a topic - equivalent to MQTT publish"""
        if not self.producer:
            self.setup_kafka_client()

        try:
            future = self.producer.send(topic_name, value=payload)
            # Wait for the message to be sent
            record_metadata = future.get(timeout=10)
            logger.debug(f"Message published to topic {topic_name}, partition {record_metadata.partition}, offset {record_metadata.offset}")
        except KafkaError as e:
            logger.error(f"Failed to publish to topic {topic_name}: {e}")
            raise

    def loop_forever(self):
        """Start consuming messages forever - equivalent to MQTT loop_forever"""
        if not self.consumer:
            logger.warning("No consumer set up. Call subscribe() first.")
            return

        self.running = True
        logger.info("Starting Kafka consumer loop...")

        try:
            for message in self.consumer:
                if not self.running:
                    break

                self.on_message(message.topic, message.value, message.key)
        except KeyboardInterrupt:
            logger.info("Consumer loop interrupted by user")
        except Exception as e:
            logger.error(f"Error in consumer loop: {e}")
        finally:
            self.running = False
            if self.consumer:
                self.consumer.close()

    def loop_start(self):
        """Start consuming messages in a separate thread - equivalent to MQTT loop_start"""
        if not self.consumer:
            logger.warning("No consumer set up. Call subscribe() first.")
            return

        if self.consumer_thread and self.consumer_thread.is_alive():
            logger.warning("Consumer thread already running")
            return

        self.running = True
        self.consumer_thread = threading.Thread(target=self._consumer_loop, daemon=True)
        self.consumer_thread.start()
        logger.info("Kafka consumer thread started")

    def _consumer_loop(self):
        """Internal consumer loop for threaded operation"""
        try:
            for message in self.consumer:
                if not self.running:
                    break

                self.on_message(message.topic, message.value, message.key)
        except Exception as e:
            logger.error(f"Error in consumer thread: {e}")
        finally:
            if self.consumer:
                self.consumer.close()

    def stop(self):
        """Stop the consumer loop"""
        self.running = False
        if self.consumer_thread:
            self.consumer_thread.join(timeout=5)
        if self.producer:
            self.producer.close()
        logger.info("Kafka client stopped")

    # Callback methods (similar to MQTT callbacks)
    def on_connect(self, *args, **kwargs):
        """Called when connected - for compatibility with MQTT interface"""
        logger.info("Kafka client connected")

    def on_publish(self, topic, payload):
        """Called when message is published - for compatibility with MQTT interface"""
        logger.debug(f"[Kafka message published] topic: {topic}")

    def on_subscribe(self, topic):
        """Called when subscribed to topic - for compatibility with MQTT interface"""
        logger.debug(f"Subscribed to topic: {topic}")

    def on_message(self, topic, payload, key=None):
        """Called when message is received - for compatibility with MQTT interface"""
        logger.debug(f"{topic} - {payload}")

        # Call specific callback if registered
        if topic in self.message_callbacks:
            self.message_callbacks[topic](topic, payload, key)

    def on_disconnect(self, *args, **kwargs):
        """Called when disconnected - for compatibility with MQTT interface"""
        logger.info("Kafka client disconnected")

# Topic naming utilities
class KafkaTopics:
    """Helper class for managing Kafka topic names"""

    @staticmethod
    def device_topic(device_id, device_type):
        """Generate device data topic: bike.{device_id}.{device_type}"""
        return f"bike.{device_id}.{device_type}"

    @staticmethod
    def control_topic(device_id, control_type):
        """Generate control topic: bike.{device_id}.{control_type}.control"""
        return f"bike.{device_id}.{control_type}.control"

    @staticmethod
    def report_topic(device_id, report_type):
        """Generate report topic: bike.{device_id}.{report_type}.report"""
        return f"bike.{device_id}.{report_type}.report"

if __name__ == '__main__':
    KAFKA_BOOTSTRAP_SERVERS = 'localhost:9092'

    client = KafkaClient(KAFKA_BOOTSTRAP_SERVERS)
    client.setup_kafka_client()

    # Example usage
    try:
        client.publish('test.topic', {'message': 'Hello from Kafka!'})
        logger.info("Test message published successfully")
    except Exception as e:
        logger.error(f"Failed to publish test message: {e}")

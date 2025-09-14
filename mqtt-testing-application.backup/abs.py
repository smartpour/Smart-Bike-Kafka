import paho.mqtt.client as mqtt
import os
import subprocess

BIKE_ID = os.getenv("BIKEID", "000001")

MQTT_BROKER = "your_mqtt_broker_address"
MQTT_PORT = 1883
MQTT_TOPIC = f"bike/{BIKE_ID}/startWorkout"

WORKOUT_SCRIPTS = {
    "Ramped": "start_ramped_workout.py",
    "Interval": "start_interval_workout.py",
    "Steady": "start_steady_workout.py"
}

def on_connect(client, userdata, flags, rc):
    """Callback for when the client connects to the broker."""
    if rc == 0:
        print("Connected to MQTT broker")
        client.subscribe(MQTT_TOPIC)
        print(f"Subscribed to topic: {MQTT_TOPIC}")
    else:
        print(f"Connection failed with code {rc}")

def on_message(client, userdata, msg):
    """Callback for when a message is received."""
    payload = msg.payload.decode()
    print(f"Message received: {payload}")

    if payload in WORKOUT_SCRIPTS:
        script = WORKOUT_SCRIPTS[payload]
        try:
            print(f"Starting workout script: {script}")
            subprocess.run(["python3", script], check=True)
        except Exception as e:
            print(f"Error running script {script}: {e}")
    else:
        print(f"Unrecognized payload: {payload}")

def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
    except Exception as e:
        print(f"Failed to connect to MQTT broker: {e}")
        return
    
    client.loop_forever()

if __name__ == "__main__":
    main()

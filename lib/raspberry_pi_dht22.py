# raspberry_pi_dht22.py

import Adafruit_DHT
import time

DHT_SENSOR = Adafruit_DHT.DHT22
DHT_PIN = 4

while True:
    humidity, temperature = Adafruit_DHT.read_retry(DHT_SENSOR, DHT_PIN)
    if humidity is not None and temperature is not None:
        print(f"{temperature:.1f},{humidity:.1f}")
    else:
        print("Failed to retrieve data from DHT22 sensor")
    time.sleep(5)
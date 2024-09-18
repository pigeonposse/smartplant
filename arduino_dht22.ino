// arduino_dht22.ino

#include <DHT.h>

#define DHTPIN 2         // Pin al que está conectado el sensor
#define DHTTYPE DHT22    // Tipo de sensor DHT (DHT22 o DHT11)

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  // Lee la humedad y la temperatura
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature(); // Lee en grados Celsius

  // Verifica si la lectura falló y termina el programa si es así
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }

  // Imprime los resultados en el puerto serie
  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.print(" C\t");
  Serial.print("Humidity: ");
  Serial.print(humidity);
  Serial.println(" %");

  delay(5000);  // Espera 5 segundos antes de la siguiente lectura
}

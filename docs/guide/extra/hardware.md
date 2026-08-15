# Hardware autodetection

## 🔎 Hardware autodetection

```bash
smartplant diagnose
```

```
Board:     Raspberry Pi 4 (Raspberry Pi 4 Model B Rev 1.4)
Platform:  linux/arm64, 4 core(s), 8GB
Serial:    /dev/ttyUSB0 — ESP32 / ESP8266 (CP210x)
I2C:       0x23 BH1750, 0x76 BME280 / BMP280
Camera:    /dev/video0
Packages:  missing onnxruntime-node

Suggested: sensor "serial" (confidence 0.9)
  · Found ESP32 / ESP8266 (CP210x) on /dev/ttyUSB0. Flash it with the generated
    firmware and read over USB.
  · Camera available at /dev/video0 — the vision layer can use it.
  · No GPU: prefer the classical vision tier, or a small quantized ONNX model.
```

Identifies the board from the device tree, serial devices by USB vendor id, I2C sensors by address, and which optional packages are installed — then recommends a config and a firmware target with its reasoning and a confidence. Read-only throughout: it lists and reads, never writes or disturbs a bus.

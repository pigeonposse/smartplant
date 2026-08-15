# What has touched hardware

Worth knowing before trusting any of it with a plant you care about, and the reason the hardware badge above is narrow rather than green.

**Exercised against something real.** Serial, over a pseudo-terminal the `serialport` package cannot distinguish from a port with an Arduino on it — JSON frames, CSV frames, rubbish on the line, and a device that stops talking going stale rather than serving its last value forever. MQTT, against a real broker over a real socket using the same `mqtt` package you would install, including a retained message published before subscribing and wildcard topics. The electrode over that same real serial transport rather than its simulator.

**Never touched a device.** Everything else. No ESP32-S3 with CSI firmware has fed the presence driver, no RPLIDAR the lidar one, no Lepton the thermal one, and no real Home Assistant has answered the integration — that was a stand-in server speaking its API, which proves the library speaks the language and not that Home Assistant accepts it. The seven AI providers are exercised through their timeout paths and never really called.

The physiology rests on published work rather than on validation with plants. That low red:far-red suppresses jasmonate signalling is well established; that this code produces that response in a living plant is not something anybody has checked.

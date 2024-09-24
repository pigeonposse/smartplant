
# SmartPlant by *PIGEONPOSSE*

[![HEADER](https://github.com/pigeonposse/.github/blob/main/docs/banner-smartplant.png?raw=true)](https://github.com/pigeonposse)


**SmartPlant** is a library designed to simplify plant care through *the integration of advanced artificial intelligence models*. This technology not only researches detailed information about each type of plant but also determines the optimal conditions for their care, thereby maximizing their growth and health. Thanks to this functionality, users can efficiently monitor and manage the environment of their plants *using sensors that measure humidity, light, and temperature*.

The core idea behind SmartPlant is to *pave the way for advancements in plant care technology*. It serves as a foundation for developing more sophisticated solutions and experimenting with innovative devices that meet the needs of plants. By leveraging this library, developers can contribute to the evolution of the smart plant care ecosystem.

> [!WARNING]
> Currently in phase `Beta`

## AI and the future intertwine: connect with your environment.

## Features

- 🤖 **Integrated Artificial Intelligence:** Optimizes the care of each plant.
- 📊 **Real-Time Monitoring:** Collects humidity, light, and temperature with sensors.
- 🔔 **Customized Alerts:** Notifications for out-of-range conditions.
- 🌍 **Multilingual Support:** English, Español, Français, Deutsch, Italiano, Português, Nederlands, Русский, 中文, 日本語.
- 🎛 **Easy Setup:** Intuitive process for Raspberry Pi or Arduino.
- 📈 **Data History:** Environmental trend analysis.
- 🔮 **Critical Condition Prediction:** Prevents significant changes in plant health.


## Installation

To install the library, use npm:

```
npm install smartplant
```

## Emojis scales for parameter monitoring

To make the plant monitoring more intuitive and visually accessible, we have implemented an emojis system that represents different levels of each critical parameter: moisture, light and temperature.Each emoji offers a rapid representation of the current status of the parameter, which facilitates interpretation without analyzing specific numbers.

#### Humidity:
- 🍂 ** (Very dry): ** Indicates that moisture is below the recommended minimum range.The plant is at risk of dehydration.
- 🌿 ** (Ideal): ** Moisture is within the ideal range, which means that the plant is in optimal conditions.
- 💧 ** (slightly wet): ** Indicates that moisture is slightly above the ideal range, but it is not yet worrisome.
- 🌊 ** (very humid): ** Moisture is above the maximum allowed range, which could lead to saturation and problems such as waterlogging.

#### Light:
- 🌑 ** (Very little light): ** points out that the plant receives less light than necessary, which could affect its growth.
- 🌥 ** (Ideal): ** The plant receives the amount of light adequate for healthy development.
- 🌞 ** (Too much light): ** Light exposure is excessive, which can cause burns or stress in the plant.

#### Temperature:
- 🧊 ** (Very cold): ** The temperature is below the minimum range, which can slow down or damage the plant.
- 🌡️ ** (Ideal): ** The temperature is in the optimal range for the growth and development of the plant.
- 🔥 ** (Very hot): ** The temperature exceeds the maximum range, which could cause overheating and dehydration.

### Emojis-based happiness system

In addition to the specific parameters, we have designed a system of general happiness for the plant, which is represented with caritas emojis.This system provides a global vision of the state of the plant, based on a combination of its levels of humidity, light and temperature.

#### Happiness scale:
- 🤩 ** (Very happy): ** The plant is in ideal conditions in all key parameters.This is the optimal state.
- 😊 ** (Happy): ** The plant is in good condition, although there could be slight deviations in some parameters.
- 😐 ** (acceptable): ** The plant is in acceptable conditions, but is far from ideal.Small adjustments may be required.
- 😞 ** (bad conditions): ** The plant is experiencing unfavorable conditions and needs attention to avoid major damage.
- 😖 ** (Critical conditions): ** The plant is in a critical state and requires immediate action to prevent its condition will get worse.
- 🥵 ** (Extremely critical): ** The plant is in an extremely critical state and is in danger of dying if urgent measures are not taken.

# Benefits of the emojis system

This approach with emojis provides a simplified and visually attractive user experience.It allows even those without deep technical knowledge to quickly understand the state of the plant and take the necessary measures.It is a way to offer immediate and clear feedback, improving interaction with the system and promoting more regular and careful maintenance of the plant.


## Contributions

Contributions are welcome. If you wish to contribute, please review the \[CONTRIBUTING.md\](CONTRIBUTING.md) file for more details.

## License

This project is licensed under the MIT License - see the \[LICENSE\](LICENSE) file for details.

## Contact

For questions or support, contact \[your-email@example.com\](mailto:your-email@example.com).

- - -

Thank you for using **SmartPlant**. We hope you enjoy managing your plants with our library.
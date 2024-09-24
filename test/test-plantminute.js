import chalk from 'chalk';

class PlantMonitor {
    constructor() {
        this.plantName = 'Monstera deliciosa';
        this.ranges = {
            light: { min: 500, max: 1000 },
            temperature: { min: 20, max: 25 },
            humidity: { min: 40, max: 60 }
        };
        this.sensors = {
            light: null,
            temperature: null,
            humidity: null
        };
    }

    generateRandomValue(min, max) {
        return Math.random() * (max - min) + min;
    }

    simulateSensorReadings() {
        this.sensors.light = this.generateRandomValue(400, 1100);
        this.sensors.temperature = this.generateRandomValue(18, 27);
        this.sensors.humidity = this.generateRandomValue(35, 65);
    }

    calculatePercentage(value, min, max) {
        return Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
    }

    getEmoji(percentage) {
        if (percentage >= 90) return '🤩';
        if (percentage >= 75) return '😊';
        if (percentage >= 60) return '😐';
        if (percentage >= 45) return '😞';
        if (percentage >= 30) return '😖';
        return '🥵';
    }

    getLightEmoji(percentage) {
        if (percentage <= 30) return '🌑';
        if (percentage <= 60) return '🌥';
        return '🌞';
    }

    getTemperatureEmoji(percentage) {
        if (percentage <= 30) return '🧊';
        if (percentage <= 80) return '🌡️';
        return '🔥';
    }

    getHumidityEmoji(percentage) {
        if (percentage <= 30) return '🍂';
        if (percentage <= 60) return '🌿';
        if (percentage <= 80) return '💧';
        return '🌊';
    }

    logPlantStatus() {
        this.simulateSensorReadings();

        const lightPercentage = this.calculatePercentage(this.sensors.light, this.ranges.light.min, this.ranges.light.max);
        const temperaturePercentage = this.calculatePercentage(this.sensors.temperature, this.ranges.temperature.min, this.ranges.temperature.max);
        const humidityPercentage = this.calculatePercentage(this.sensors.humidity, this.ranges.humidity.min, this.ranges.humidity.max);

        const averagePercentage = (lightPercentage + temperaturePercentage + humidityPercentage) / 3;

        const happinessEmoji = this.getEmoji(averagePercentage);
        const lightEmoji = this.getLightEmoji(lightPercentage);
        const temperatureEmoji = this.getTemperatureEmoji(temperaturePercentage);
        const humidityEmoji = this.getHumidityEmoji(humidityPercentage);

        const status = `${happinessEmoji} | Lighting: ${lightEmoji} (${this.sensors.light.toFixed(0)}) | Temperature: ${temperatureEmoji} (${this.sensors.temperature.toFixed(1)}°C) | Humidity: ${humidityEmoji} (${this.sensors.humidity.toFixed(0)}%)`;

        console.log(status);

        this.checkAlerts();
    }

    checkAlerts() {
        for (const [sensor, value] of Object.entries(this.sensors)) {
            if (value < this.ranges[sensor].min) {
                console.log(chalk.yellow(`🔔 Warning: ${sensor} is too low (${value.toFixed(1)})`));
            } else if (value > this.ranges[sensor].max) {
                console.log(chalk.yellow(`🔔 Warning: ${sensor} is too high (${value.toFixed(1)})`));
            }
        }
    }

    startMonitoring() {
        console.log(chalk.bold(`Starting monitoring for ${this.plantName}`));
        console.log(chalk.bold(`Ideal Ranges:`));
        console.log(chalk.bold(`Lighting: ${this.ranges.light.min}-${this.ranges.light.max} lux`));
        console.log(chalk.bold(`Temperature: ${this.ranges.temperature.min}-${this.ranges.temperature.max}°C`));
        console.log(chalk.bold(`Humidity: ${this.ranges.humidity.min}-${this.ranges.humidity.max}%`));
        console.log(chalk.bold(`Monitoring started. Press Ctrl+C to stop.`));

        this.monitoringInterval = setInterval(() => {
            this.logPlantStatus();
        }, 60000); // Log every minute

        // Log immediately on start
        this.logPlantStatus();
    }
}

const monitor = new PlantMonitor();
monitor.startMonitoring();
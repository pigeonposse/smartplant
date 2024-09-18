import { execSync } from 'child_process';
import { prompt } from 'enquirer';
import path from 'path';
import fs from 'fs'
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load messages based on selected language
function loadMessages(language) {
    const languageFile = path.join(__dirname, `language/messages-${language}.json`);
    try {
        return JSON.parse(fs.readFileSync(languageFile, 'utf8'));
    } catch (error) {
        console.error(`Error loading language file: ${error.message}`);
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'language/messages-en.json'), 'utf8')); // Fallback to English
    }
}

class PlantInfoGenerator {
    async generatePlantInfo(name, type) {
        try {
            const info = await this.fetchInfoFromAI(name, type);
            return info;
        } catch (error) {
            console.error(`Error generating plant info: ${error.message}`);
            return {
                description: 'No description available.',
                characteristics: 'No characteristics available.',
                moisture: { ideal: 50, min: 30, max: 70 },
                light: { ideal: 500, min: 200, max: 800 },
                temperature: { ideal: 22, min: 15, max: 30 }
            };
        }
    }

    async fetchInfoFromAI(name, type) {
        // Simulated AI response. Replace with actual AI interaction or API call.
        return new Promise((resolve) => {
            setTimeout(() => {
                const info = {
                    description: `The ${name} is a ${type === 'indoor' ? 'popular indoor' : 'common outdoor'} plant, known for its ${type === 'indoor' ? 'air-purifying qualities' : 'resilience to various weather conditions'}.`,
                    characteristics: `${name} typically has ${type === 'indoor' ? 'glossy, dark green leaves' : 'vibrant flowers and sturdy stems'}. It's ${type === 'indoor' ? 'well-suited for low-light environments' : 'adaptable to different soil types'}.`,
                    moisture: {
                        ideal: type === 'indoor' ? 60 : 40,
                        min: type === 'indoor' ? 40 : 20,
                        max: type === 'indoor' ? 80 : 60
                    },
                    light: {
                        ideal: type === 'indoor' ? 400 : 700,
                        min: type === 'indoor' ? 200 : 500,
                        max: type === 'indoor' ? 600 : 900
                    },
                    temperature: {
                        ideal: type === 'indoor' ? 22 : 25,
                        min: type === 'indoor' ? 18 : 15,
                        max: type === 'indoor' ? 26 : 35
                    }
                };
                resolve(info);
            }, 1000);
        });
    }
}

class SmartPlant {
    constructor() {
        this.apiKey = null;
        this.plantType = null;
        this.plantName = '';
        this.alerts = {};
        this.language = 'en';
        this.messages = null;
        this.sensors = {
            moisture: null,
            light: null,
            temperature: null
        };
        this.plantInfo = null;
        this.plantInfoGenerator = new PlantInfoGenerator();
    }

    async init() {
        this.messages = loadMessages(this.language);
    }

    async setLanguage(language) {
        this.language = language;
        this.messages = loadMessages(this.language);
    }

    welcome() {
        console.log(this.messages.general.welcome);
    }

    async start() {
        await this.init();
        this.welcome();
        await this.selectLanguage();
        await this.selectPlatform();
        await this.selectInputMethod();
        await this.selectPlantType();
        await this.setPlantName();
        await this.generatePlantInfo();
        await this.setupSensors();
        this.setupAlerts();
        this.activateAlerts();
        this.startMonitoring();
    }

    async selectLanguage() {
        const response = await prompt({
            type: 'select',
            name: 'language',
            message: 'Select language:',
            choices: [
                { name: 'en', message: 'English' },
                { name: 'es', message: 'Español' },
                { name: 'fr', message: 'Français' },
                { name: 'de', message: 'Deutsch' },
                { name: 'it', message: 'Italiano' },
                { name: 'pt', message: 'Português' },
                { name: 'nl', message: 'Nederlands' },
                { name: 'ru', message: 'Русский' },
                { name: 'zh', message: '中文' },
                { name: 'ja', message: '日本語' }
            ]
        });

        await this.setLanguage(response.language);
    }

    async selectPlatform() {
        const response = await prompt({
            type: 'select',
            name: 'platform',
            message: this.messages.general.selectPlatform,
            choices: [
                { name: 'raspberry', message: 'Raspberry Pi' },
                { name: 'arduino', message: 'Arduino' }
            ]
        });

        this.platform = response.platform;
    }

    async selectInputMethod() {
        const response = await prompt({
            type: 'select',
            name: 'method',
            message: this.messages.general.selectInputMethod,
            choices: [
                { name: 'local', message: this.messages.general.local },
                { name: 'extern', message: this.messages.general.external }
            ]
        });

        if (response.method === 'local') {
            console.log(this.messages.general.localSelected);
            const aiDetector = new AIDetector();
            const aiModels = await aiDetector.detectAI();
            if (aiModels) {
                const modelResponse = await prompt({
                    type: 'select',
                    name: 'model',
                    message: this.messages.general.selectAIModel,
                    choices: aiModels.models
                });
                console.log(this.messages.general.selectedAIModel.replace('{model}', modelResponse.model));
            } else {
                console.log(this.messages.general.noLocalAI);
            }
        } else if (response.method === 'extern') {
            console.log(this.messages.general.externSelected);
            const apiKeyResponse = await prompt({
                type: 'password',
                name: 'apiKey',
                message: this.messages.general.enterAPIKey
            });
            this.apiKey = apiKeyResponse.apiKey;
        } else {
            console.log(this.messages.general.invalidMethod);
        }
    }

    async selectPlantType() {
        const response = await prompt({
            type: 'select',
            name: 'type',
            message: this.messages.general.selectPlantType,
            choices: [
                { name: 'indoor', message: this.messages.general.indoor },
                { name: 'outdoor', message: this.messages.general.outdoor }
            ]
        });

        if (['indoor', 'outdoor'].includes(response.type)) {
            this.plantType = response.type;
        } else {
            console.log(this.messages.general.invalidType);
        }
    }

    async setPlantName() {
        const response = await prompt({
            type: 'input',
            name: 'name',
            message: this.messages.general.enterPlantName
        });
        this.plantName = response.name;
        console.log(this.messages.general.plantNameSet.replace('{name}', this.plantName));
    }

    async generatePlantInfo() {
        console.log(this.messages.general.generatingPlantInfo);
        try {
            this.plantInfo = await this.plantInfoGenerator.generatePlantInfo(this.plantName, this.plantType);
            console.log(this.formatPlantInfo(this.plantInfo));
        } catch (error) {
            console.error(`Error generating plant info: ${error.message}`);
        }
    }

    formatPlantInfo(data) {
        return `
📋 Description: ${data.description}
🔍 Characteristics: ${data.characteristics}
💧 Moisture level: Ideal ${data.moisture.ideal}%, Range ${data.moisture.min}%-${data.moisture.max}%
🌞 Light level: Ideal ${data.light.ideal} lux, Range ${data.light.min}-${data.light.max} lux
🌡️ Temperature range: Ideal ${data.temperature.ideal}°C, Range ${data.temperature.min}-${data.temperature.max}°C
        `;
    }

    async setupSensors() {
        console.log(this.messages.general.settingUpSensors);
        // Initialize sensors based on plant info
        this.sensors.moisture = this.plantInfo.moisture.ideal + (Math.random() - 0.5) * 10;
        this.sensors.light = this.plantInfo.light.ideal + (Math.random() - 0.5) * 100;
        this.sensors.temperature = this.plantInfo.temperature.ideal + (Math.random() - 0.5) * 2;
        console.log(this.messages.general.sensorsReady);
    }

    setupAlerts() {
        this.alerts = {
            moisture: { min: this.plantInfo.moisture.min, max: this.plantInfo.moisture.max },
            light: { min: this.plantInfo.light.min, max: this.plantInfo.light.max },
            temperature: { min: this.plantInfo.temperature.min, max: this.plantInfo.temperature.max }
        };
        console.log(this.messages.general.alertsConfigured);
    }

    activateAlerts() {
        console.log(this.messages.general.alertsActivated);
    }

    startMonitoring() {
        console.log(this.messages.general.startingMonitoring);
        setInterval(() => this.checkPlantStatus(), 5000); // Check every 5 seconds
    }

    checkPlantStatus() {
        console.log(this.messages.general.checkingStatus);
        this.updateSensorData();
        this.checkAlerts();
    }

    updateSensorData() {
        // Simulate sensor data changes
        this.sensors.moisture += (Math.random() - 0.5) * 5;
        this.sensors.light += (Math.random() - 0.5) * 50;
        this.sensors.temperature += (Math.random() - 0.5) * 2;

        // Ensure values stay within realistic ranges
        this.sensors.moisture = Math.max(0, Math.min(100, this.sensors.moisture));
        this.sensors.light = Math.max(0, Math.min(1000, this.sensors.light));
        this.sensors.temperature = Math.max(0, Math.min(50, this.sensors.temperature));
    }

    checkAlerts() {
        for (const [sensor, value] of Object.entries(this.sensors)) {
            if (value < this.alerts[sensor].min) {
                console.log(this.messages.alerts[sensor].low.replace('{value}', value.toFixed(2)));
            } else if (value > this.alerts[sensor].max) {
                console.log(this.messages.alerts[sensor].high.replace('{value}', value.toFixed(2)));
            }
        }
    }
}

class AIDetector {
    async detectAI() {
        try {
            const output = execSync('ollama list', { encoding: 'utf-8' });
            const models = output.split('\n').filter(line => line.trim()).map(line => line.split(' ')[0]);
            if (models.length > 0) {
                return {
                    name: 'ollama',
                    models: models
                };
            }
        } catch (error) {
            console.error('Error detecting AI:', error.message);
        }
        return null;
    }
}

// Initialize SmartPlant
const smartPlant = new SmartPlant();
smartPlant.start();

export default SmartPlant 
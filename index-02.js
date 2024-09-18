import { execSync } from 'child_process';
import pkg from 'enquirer';  // Cambiado de `import { prompt } from 'enquirer';`
const { prompt } = pkg;     // Desestructurado de `pkg`
import path from 'path';
import fs from 'fs';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadMessages(language) {
    const languageFile = path.join(__dirname, `language/messages-${language}.json`);
    try {
        return JSON.parse(fs.readFileSync(languageFile, 'utf8'));
    } catch (error) {
        console.error(`Error loading language file: ${error.message}`);
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'language/messages-en.json'), 'utf8'));
    }
}

class PlantDates {
    constructor(name, type, aiClient) {
        this.name = name;
        this.type = type;
        this.aiClient = aiClient;
    }

    async generateInfo() {
        console.log(chalk.bold('Recopilando datos...'));
        const prompt = `
            Generate detailed information about the ${this.name} plant, which is typically grown ${this.type}.
            Include a description, characteristics, and ideal ranges for moisture (in percentage), light (in lux), and temperature (in Celsius).
            Format the response as a JSON object with the following structure:
            {
                "description": "...",
                "characteristics": "...",
                "moisture": { "ideal": 0, "min": 0, "max": 0 },
                "light": { "ideal": 0, "min": 0, "max": 0 },
                "temperature": { "ideal": 0, "min": 0, "max": 0 }
            }
        `;

        try {
            const aiResponse = await this.aiClient.generateResponse(prompt);
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error generating plant info:', error);
            return {
                description: 'No description available.',
                characteristics: 'No characteristics available.',
                moisture: { ideal: 50, min: 30, max: 70 },
                light: { ideal: 500, min: 200, max: 800 },
                temperature: { ideal: 22, min: 15, max: 30 }
            };
        }
    }
}

class AIClient {
    constructor(type, apiKey, localModel) {
        this.type = type;
        this.apiKey = apiKey;
        this.localModel = localModel;
    }

    async generateResponse(prompt) {
        switch (this.type) {
            case 'openai':
                return this.generateOpenAIResponse(prompt);
            case 'anthropic':
                return this.generateAnthropicResponse(prompt);
            case 'cohere':
                return this.generateCohereResponse(prompt);
            case 'ai21':
                return this.generateAI21Response(prompt);
            case 'local':
                return this.generateLocalResponse(prompt);
            default:
                throw new Error('Unsupported AI type');
        }
    }

    async generateOpenAIResponse(prompt) {
        const response = await axios.post('https://api.openai.com/v1/engines/davinci-codex/completions', {
            prompt: prompt,
            max_tokens: 500,
            n: 1,
            stop: null,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].text.trim();
    }

    async generateAnthropicResponse(prompt) {
        throw new Error('Anthropic API not implemented');
    }

    async generateCohereResponse(prompt) {
        throw new Error('Cohere API not implemented');
    }

    async generateAI21Response(prompt) {
        throw new Error('AI21 API not implemented');
    }

    async generateLocalResponse(prompt) {
        return new Promise((resolve, reject) => {
            execSync(`ollama run ${this.localModel} "${this.sanitizeInput(prompt)}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(`Error: ${error.message}`);
                    return;
                }
                if (stderr) {
                    reject(`Error: ${stderr}`);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    sanitizeInput(input) {
        return input.replace(/"/g, '\\"').replace(/\n/g, ' ');
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
            console.error('Error detecting Ollama:', error.message);
        }
        return null;
    }
}

class SmartPlant {
    constructor() {
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
        this.platform = null;
        this.serialPort = null;
        this.aiClient = null;
        this.aiDetector = new AIDetector();
    }

    async init() {
        this.messages = loadMessages(this.language);
    }

    async setLanguage(language) {
        this.language = language;
        this.messages = loadMessages(this.language);
    }

    welcome() {
        console.log(chalk.bold(this.messages.general.welcome));
    }

    async start() {
        await this.init();
        this.welcome();
        await this.selectLanguage();
        await this.selectPlatform();
        await this.selectAIMethod();
        await this.selectPlantType();
        await this.setPlantName();
        await this.generatePlantInfo();
        await this.setupSensors();
        this.setupAlerts();
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
        await this.setupPlatform();
    }

    async setupPlatform() {
        if (this.platform === 'raspberry') {
            console.log(chalk.bold('Setting up Raspberry Pi...'));
            console.log('Raspberry Pi setup complete. Make sure raspberry_pi_dht22.py is in the correct location.');
        } else if (this.platform === 'arduino') {
            console.log(chalk.bold('Setting up Arduino...'));
            this.serialPort = new SerialPort({ path: '/dev/ttyACM0', baudRate: 9600 });
            const parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
            parser.on('data', this.handleArduinoData.bind(this));
            console.log('Arduino setup complete. Make sure arduino_dht22.ino is uploaded to your Arduino.');
        }
    }

    handleArduinoData(data) {
        const [temperature, humidity, light] = data.split(',').map(Number);
        this.sensors.temperature = temperature;
        this.sensors.moisture = humidity;
        this.sensors.light = light;
        this.checkAlerts();
    }

    async selectAIMethod() {
        const response = await prompt({
            type: 'select',
            name: 'method',
            message: 'Select AI method:',
            choices: [
                { name: 'local', message: 'Local (Ollama)' },
                { name: 'openai', message: 'OpenAI API' },
                { name: 'anthropic', message: 'Anthropic API' },
                { name: 'cohere', message: 'Cohere API' },
                { name: 'ai21', message: 'AI21 API' }
            ]
        });

        if (response.method === 'local') {
            await this.selectLocalModel();
        } else {
            const apiKeyResponse = await prompt({
                type: 'input',
                name: 'apiKey',
                message: 'Enter your API key:'
            });
            this.aiClient = new AIClient(response.method, apiKeyResponse.apiKey);
        }
    }

    async selectLocalModel() {
        const aiModels = await this.aiDetector.detectAI();
        if (aiModels) {
            const response = await prompt({
                type: 'select',
                name: 'model',
                message: 'Select a local model:',
                choices: aiModels.models.map(model => ({ name: model, message: model }))
            });
            this.aiClient = new AIClient('local', null, response.model);
        } else {
            console.log('No local AI models found.');
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
        const plantDates = new PlantDates(this.plantName, this.plantType, this.aiClient);
        this.plantInfo = await plantDates.generateInfo();
        console.log(this.formatPlantInfo(this.plantInfo));
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
        console.log(chalk.bold(this.messages.general.settingUpSensors));
        if (this.platform === 'raspberry') {
            setInterval(() => {
                this.sensors.moisture = this.plantInfo.moisture.ideal + (Math.random() - 0.5) * 10;
                this.sensors.light = this.plantInfo.light.ideal + (Math.random() - 0.5) * 100;
                this.sensors.temperature = this.plantInfo.temperature.ideal + (Math.random() - 0.5) * 5;
                this.checkAlerts();
            }, 5000);
        }
        console.log(chalk.bold(this.messages.general.sensorsReady));
    }

    setupAlerts() {
        console.log(this.messages.general.settingUpAlerts);
        this.alerts = {
            moisture: { min: this.plantInfo.moisture.min, max: this.plantInfo.moisture.max },
            light: { min: this.plantInfo.light.min, max: this.plantInfo.light.max },
            temperature: { min: this.plantInfo.temperature.min, max: this.plantInfo.temperature.max }
        };
        console.log(this.messages.general.alertsSet);
    }

    startMonitoring() {
        console.log(this.messages.general.startMonitoring);
        setInterval(() => {
            this.logPlantStatus();
        }, 60000); // Log every minute
    }

    logPlantStatus() {
        const status = `${this.plantName} (${this.plantType}) — Moisture level: ${this.sensors.moisture.toFixed(2)}%  |||  Light level: ${this.sensors.light.toFixed(2)} lux  |||  Temperature: ${this.sensors.temperature.toFixed(2)}°C`;
        console.log(status);
    }

    checkAlerts() {
        for (const [sensor, value] of Object.entries(this.sensors)) {
            if (value < this.alerts[sensor].min) {
                console.log(chalk.red(this.messages.alerts[sensor].low.replace('{value}', value.toFixed(2))));
            } else if (value > this.alerts[sensor].max) {
                console.log(chalk.red(this.messages.alerts[sensor].high.replace('{value}', value.toFixed(2))));
            }
        }
    }
}

const smartPlant = new SmartPlant();
smartPlant.start().catch(console.error);

export default SmartPlant;

/* eslint-disable camelcase */
import { ReadlineParser } from '@serialport/parser-readline'
import chalk              from 'chalk'
import enquirer           from 'enquirer'
import { execSync }       from 'node:child_process'
import { SerialPort }     from 'serialport'

import MsgDe from './language/messages-de.js'
import MsgEn from './language/messages-en.js'
import MsgEs from './language/messages-es.js'
import MsgFr from './language/messages-fr.js'
import MsgIt from './language/messages-it.js'
import MsgJa from './language/messages-ja.js'
import MsgPt from './language/messages-pt.js'
import MsgRu from './language/messages-ru.js'
import MsgZh from './language/messages-zh.js'

// eslint-disable-next-line jsdoc/require-jsdoc
function loadMessages( language ) {

	const messages = {
		de : MsgDe,
		en : MsgEn,
		es : MsgEs,
		fr : MsgFr,
		ja : MsgJa,
		it : MsgIt,
		pt : MsgPt,
		ru : MsgRu,
		zh : MsgZh,
	}
    
	try {

		return messages[ language ] || MsgEn // Carga el archivo del idioma o el inglés por defecto
	
	} catch ( error ) {

		console.error( `Error loading language file: ${error.message}` )
		return MsgEn // Si hay algún error, carga los mensajes en inglés por defecto
	
	}

}

class AIClient {

	constructor( type, apiKey, localModel ) {

		this.type       = type
		this.apiKey     = apiKey
		this.localModel = localModel
	
	}

	async generateResponse( prompt, language ) {

		const languagePrompt = `Respond in ${language}. `
		const fullPrompt     = languagePrompt + prompt
        
		switch ( this.type ) {

			case 'openai' :
				return this.generateOpenAIResponse( fullPrompt )
			case 'local' :
				return this.generateLocalResponse( fullPrompt )
			default :
				throw new Error( 'Unsupported AI type' )
		
		}
	
	}

	async generateOpenAIResponse( prompt ) {

		try {

			const response = await fetch( 'https://api.openai.com/v1/engines/davinci-codex/completions', {
				method  : 'POST',
				headers : {
					'Authorization' : `Bearer ${this.apiKey}`,
					'Content-Type'  : 'application/json',
				},
				body : JSON.stringify( {
					prompt      : prompt,
					max_tokens  : 500,
					n           : 1,
					stop        : null,
					temperature : 0.7,
				} ),
			} )
          
			if ( !response.ok ) {

				throw new Error( `HTTP error! status: ${response.status}` )
			
			}
          
			const data = await response.json()
			return data.choices[ 0 ].text.trim()
          
		} catch ( error ) {

			console.error( 'Error generating OpenAI response:', error )
			return null
		
		}
	
	}

	async generateLocalResponse( prompt ) {

		try {

			const command = `ollama run ${this.localModel} "${this.sanitizeInput( prompt )}"`
			const output  = execSync( command, { encoding: 'utf-8' } )
			return output.trim()
		
		} catch ( error ) {

			console.error( 'Error generating local response:', error )
			return null
		
		}
	
	}

	sanitizeInput( input ) {

		return input.replace( /"/g, '\\"' ).replace( /\n/g, ' ' )
	
	}

}

class AIDetector {

	async detectAI() {

		try {

			const output = execSync( 'ollama list', { encoding: 'utf-8' } )
			const models = output.split( '\n' )
				.filter( line => line.trim() && !line.startsWith( 'NAME' ) )
				.map( line => line.split( ' ' )[ 0 ] )
			if ( models.length > 0 ) {

				return {
					name   : 'ollama',
					models : models,
				}
			
			}
		
		} catch ( _e ) {

			console.error( 'Error detecting Ollama:' )
			process.exit( 0 )
		
		}
	
	}

}

class PlantDates {

	constructor( name, type, aiClient, language ) {

		this.name      = name
		this.type      = type
		this.aiClient  = aiClient
		this.language  = language
		this.plantInfo = null
	
	}

	async generateInfo() {

		console.log( chalk.bold( '🔍🌿 Generating plant information...' ) )
        
		try {

			const plantInfoPrompt = `Provide a comprehensive summary for ${this.name} (${this.type}) including: Lighting, Watering, Temperature, Humidity, Soil, Fertilization, Pruning, and Propagation. Also, provide specific ranges for Lighting (in lux), Temperature (in Celsius), and Humidity (in percentage) in the format: "Lighting: X-Y lux, Temperature: A-B°C, Humidity: C-D%".`
            
			const plantInfoResponse = await this.getAIResponse( plantInfoPrompt )
            
			// Extract ranges from the response
			const lightingMatch    = plantInfoResponse.match( /Lighting:\s*(\d+)-(\d+)\s*lux/i )
			const temperatureMatch = plantInfoResponse.match( /Temperature:\s*(\d+)-(\d+)\s*°C/i )
			const humidityMatch    = plantInfoResponse.match( /Humidity:\s*(\d+)-(\d+)\s*%/i )

			this.plantInfo = {
				summary  : plantInfoResponse,
				lighting : lightingMatch ? {
					min : parseInt( lightingMatch[ 1 ] ),
					max : parseInt( lightingMatch[ 2 ] ), 
				} : {
					min : 50,
					max : 700, 
				},
				temperature : temperatureMatch ? {
					min : parseInt( temperatureMatch[ 1 ] ),
					max : parseInt( temperatureMatch[ 2 ] ), 
				} : {
					min : 18,
					max : 24, 
				},
				humidity : humidityMatch ? {
					min : parseInt( humidityMatch[ 1 ] ),
					max : parseInt( humidityMatch[ 2 ] ), 
				} : {
					min : 40,
					max : 60, 
				},
			}

			return this.plantInfo
		
		} catch ( error ) {

			console.error( 'Error generating plant info:', error )
			return null
		
		}
	
	}

	async getAIResponse( prompt ) {

		try {

			const response = await this.aiClient.generateResponse( prompt, this.language )
			await this.simulateTyping( response )
			return response.trim()
		
		} catch ( error ) {

			console.error( 'Error getting AI response:', error )
			return null
		
		}
	
	}

	async simulateTyping( text ) {

		for ( let i = 0; i < text.length; i++ ) {

			process.stdout.write( text[ i ] )
			await new Promise( resolve => setTimeout( resolve, 10 ) )
		
		}
		console.log( '\n' )
	
	}

	formatPlantInfo() {

		if ( !this.plantInfo ) return 'No hay información disponible.'

		return `
Rangos ideales:
🌞 ${this.plantInfo.lighting.min}-${this.plantInfo.lighting.max} lux
🌡️ ${this.plantInfo.temperature.min}-${this.plantInfo.temperature.max}°C
💦 ${this.plantInfo.humidity.min}-${this.plantInfo.humidity.max}%
        `
	
	}

}

export class SmartPlant {

	constructor() {

		this.plantType       = null
		this.plantName       = ''
		this.alerts          = {}
		this.language        = 'en'
		this.messages        = null
		this.sensors         = {
			humidity    : null,
			light       : null,
			temperature : null,
		}
		this.plantInfo       = null
		this.platform        = null
		this.serialPort      = null
		this.aiClient        = null
		this.aiDetector      = new AIDetector()
		this.historicalData  = []
		this.isMonitoring    = false
		this.hibernationMode = false
		this.hasSensors      = false
	
	}

	async init() {

		this.messages = loadMessages( this.language )
	
	}

	async setLanguage( language ) {

		this.language = language
		this.messages = loadMessages( this.language )
	
	}

	welcome() {

		console.log( '\n' + chalk.bold( this.messages.general.welcome ) + '\n' )
	
	}

	async start() {

		await this.init()
		this.welcome()
		await this.selectLanguage()
		await this.selectPlatform()
		await this.selectAIMethod()
		console.log() // Add a space after AI connection
		await this.selectPlantType()
		await this.setPlantName()
		await this.generatePlantInfo()
		await this.setupSensors()
		this.setupAlerts()
		this.startMonitoring()
	
	}

	async selectLanguage() {

		const { language } = await enquirer.prompt( {
			type    : 'autocomplete',
			name    : 'language',
			message : 'Select language:',
			choices : [
				{
					name  : 'English',
					value : 'en', 
				},
				{
					name  : 'Español',
					value : 'es', 
				},
				{
					name  : 'Français',
					value : 'fr', 
				},
				{
					name  : 'Deutsch',
					value : 'de', 
				},
				{
					name  : 'Italiano',
					value : 'it', 
				},
				{
					name  : 'Português',
					value : 'pt', 
				},
				{
					name  : 'Nederlands',
					value : 'nl', 
				},
				{
					name  : 'Русский',
					value : 'ru', 
				},
				{
					name  : '中文',
					value : 'zh', 
				},
				{
					name  : '日本語',
					value : 'ja', 
				},
			],
		} )

		await this.setLanguage( language )
	
	}

	async selectPlatform() {

		const { platform } = await enquirer.prompt( {
			type    : 'select',
			name    : 'platform',
			message : this.messages.general.selectPlatform,
			choices : [ {
				name  : 'Raspberry Pi',
				value : 'raspberry', 
			}, {
				name  : 'Arduino',
				value : 'arduino', 
			} ],
		} )

		this.platform = platform
		await this.setupPlatform()
	
	}

	async setupPlatform() {

		if ( this.platform === 'raspberry' ) {

			console.log( chalk.bold( 'Setting up Raspberry Pi...' ) )
			this.hasSensors = true
		
		} else if ( this.platform === 'arduino' ) {

			console.log( chalk.bold( 'Setting up Arduino...' ) )
			this.serialPort = new SerialPort( {
				path     : '/dev/ttyACM0',
				baudRate : 9600, 
			} )
			const parser    = this.serialPort.pipe( new ReadlineParser( { delimiter: '\r\n' } ) )
			parser.on( 'data', this.handleArduinoData.bind( this ) )
			console.log( 'Arduino setup complete. Make sure arduino_dht22.ino is uploaded to your Arduino.' )
			this.hasSensors = true
		
		}
	
	}

	handleArduinoData( data ) {

		const [
			temperature,
			humidity,
			light,
		] = data.split( ',' ).map( Number )
		this.sensors.temperature = temperature
		this.sensors.humidity    = humidity
		this.sensors.light       = light
		this.checkAlerts()
	
	}

	async selectAIMethod() {

		const { method } = await enquirer.prompt( {
			type    : 'select',
			name    : 'method',
			message : 'Select AI method:',
			choices : [ {
				message : 'Local (Ollama)',
				value   : 'local', 
			}, {
				message : 'OpenAI API',
				value   : 'openai', 
			} ],
		} )

		if ( method === 'local' ) {

			await this.selectLocalModel()
		
		} else {

			const { apiKey } = await enquirer.prompt( {
				type    : 'password',
				name    : 'apiKey',
				message : 'Enter your API key:',
			} )
			this.aiClient    = new AIClient( method, apiKey )
		
		}
		console.log( chalk.green( 'AI successfully connected! 🤖✨' ) )
	
	}

	async selectLocalModel() {

		const aiModels = await this.aiDetector.detectAI()
		if ( aiModels && aiModels.models.length > 0 ) {

			const { model } = await enquirer.prompt( {
				type    : 'select',
				name    : 'model',
				message : 'Select a local model:',
				choices : aiModels.models,
			} )
			this.aiClient   = new AIClient( 'local', null, model )
		
		} else {

			console.log( 'No local AI models found.' )
		
		}
	
	}

	async selectPlantType() {

		const { type } = await enquirer.prompt( {
			type    : 'select',
			name    : 'type',
			message : this.messages.general.selectPlantType,
			choices : [ {
				name  : this.messages.general.indoor,
				value : 'indoor', 
			}, {
				name  : this.messages.general.outdoor,
				value : 'outdoor', 
			} ],
		} )

		this.plantType = type
	
	}

	async setPlantName() {

		const { name } = await enquirer.prompt( {
			type    : 'input',
			name    : 'name',
			message : this.messages.general.enterPlantName,
		} )
		this.plantName = name
	
	}

	async generatePlantInfo() {

		const plantDates = new PlantDates( this.plantName, this.plantType, this.aiClient, this.language )
		this.plantInfo   = await plantDates.generateInfo()
		if ( this.plantInfo ) {

			this.idealRanges = plantDates.formatPlantInfo()
		
		} else {

			console.log( 'No se pudo generar la información de la planta.' )
		
		}
	
	}

	async setupSensors() {

		console.log( chalk.bold( this.messages.general.settingUpSensors ) )
		if ( this.hasSensors ) {

			if ( this.platform === 'raspberry' ) {

				// For Raspberry Pi, we'll wait for actual sensor data
				console.log( 'Waiting for sensor data from Raspberry Pi...' )
			
			}
			// For Arduino, we're already set up in setupPlatform
		
		} else {

			console.log( chalk.yellow( 'No sensors detected. Running in simulation mode.' ) )
		
		}
		console.log( chalk.bold( this.messages.general.sensorsReady ) )
	
	}

	setupAlerts() {

		if ( this.plantInfo ) {

			this.alerts = {
				humidity : {
					min : this.plantInfo.humidity.min,
					max : this.plantInfo.humidity.max, 
				},
				light : {
					min : this.plantInfo.lighting.min,
					max : this.plantInfo.lighting.max, 
				},
				temperature : {
					min : this.plantInfo.temperature.min,
					max : this.plantInfo.temperature.max, 
				},
			}
			if( this.messages.general.alertsSet ) console.log( this.messages.general.alertsSet )
		
		} else {

			console.log( 'No se pudieron configurar las alertas debido a la falta de información de la planta.' )
		
		}
	
	}

	calculatePercentage( value, min, max ) {

		if ( value === null || value === undefined || isNaN( value ) ) {

			return 0
		
		}
		return Math.min( Math.max( ( ( value - min ) / ( max - min ) ) * 100, 0 ), 100 )
	
	}

	getHumidityEmoji( percentage ) {

		if ( percentage <= 0 ) return '🍂'
		if ( percentage <= 30 ) return '🍂'
		if ( percentage <= 60 ) return '🌿'
		if ( percentage <= 80 ) return '💧'
		return '🌊'
	
	}

	getLightEmoji( percentage ) {

		if ( percentage <= 0 ) return '🌑'
		if ( percentage <= 30 ) return '🌑'
		if ( percentage <= 60 ) return '🌥'
		return '🌞'
	
	}

	getTemperatureEmoji( percentage ) {

		if ( percentage <= 0 ) return '🧊'
		if ( percentage <= 30 ) return '🧊'
		if ( percentage <= 80 ) return '🌡️'
		return '🔥'
	
	}

	getHappinessEmoji( averagePercentage ) {

		if ( averagePercentage <= 0 ) return '😵'
		if ( averagePercentage >= 90 ) return '🤩'
		if ( averagePercentage >= 75 ) return '😊'
		if ( averagePercentage >= 60 ) return '😐'
		if ( averagePercentage >= 45 ) return '😞'
		if ( averagePercentage >= 30 ) return '😖'
		return '🥵'
	
	}

	logPlantStatus() {

		const allSensorsZero = Object.values( this.sensors ).every( value => value === 0 || value === null || value === undefined )
        
		if ( !this.hasSensors || allSensorsZero ) {

			console.log( chalk.yellow( '🔔 Warning: No data input or sensors are disconnected.' ) )
			console.log( '😵 | Lighting: 🌑 (0%) | Temperature: 🧊 (0.0°C) | Humidity: 🍂 (0%)' )
			return
		
		}

		const humidityPercentage    = this.calculatePercentage( this.sensors.humidity, this.alerts.humidity.min, this.alerts.humidity.max )
		const lightPercentage       = this.calculatePercentage( this.sensors.light, this.alerts.light.min, this.alerts.light.max )
		const temperaturePercentage = this.calculatePercentage( this.sensors.temperature, this.alerts.temperature.min, this.alerts.temperature.max )
        
		const averagePercentage = ( humidityPercentage + lightPercentage + temperaturePercentage ) / 3
        
		const happinessEmoji   = this.getHappinessEmoji( averagePercentage )
		const humidityEmoji    = this.getHumidityEmoji( humidityPercentage )
		const lightEmoji       = this.getLightEmoji( lightPercentage )
		const temperatureEmoji = this.getTemperatureEmoji( temperaturePercentage )
    
		const status = `${happinessEmoji} | Lighting: ${lightEmoji} (${lightPercentage.toFixed( 0 )}%) | Temperature: ${temperatureEmoji} (${this.sensors.temperature?.toFixed( 1 ) || 0.0}°C) | Humidity: ${humidityEmoji} (${humidityPercentage.toFixed( 0 )}%)`
		console.log( status )
    
		this.historicalData.push( {
			timestamp   : new Date(),
			humidity    : this.sensors.humidity,
			light       : this.sensors.light,
			temperature : this.sensors.temperature,
		} )
        
		this.predictCriticalState()
	
	}    

	predictCriticalState() {

		if ( this.historicalData.length < 10 ) return // Need more data for prediction

		const recentData = this.historicalData.slice( -10 )
		const trends     = {
			humidity    : this.calculateTrend( recentData.map( d => d.humidity ) ),
			light       : this.calculateTrend( recentData.map( d => d.light ) ),
			temperature : this.calculateTrend( recentData.map( d => d.temperature ) ),
		}

		for ( const [ sensor, trend ] of Object.entries( trends ) ) {

			if ( Math.abs( trend ) > 0.5 ) { // Significant trend detected

				const direction = trend > 0 ? 'increasing' : 'decreasing'
				console.log( chalk.yellow.bold( `🔔 Warning: ${sensor} is ${direction} rapidly. Consider taking action.` ) )
			
			}
		
		}
	
	}

	calculateTrend( data ) {

		const n      = data.length
		const sum_x  = n * ( n + 1 ) / 2
		const sum_y  = data.reduce( ( a, b ) => a + b, 0 )
		const sum_xy = data.reduce( ( sum, y, i ) => sum + y * ( i + 1 ), 0 )
		const sum_xx = n * ( n + 1 ) * ( 2 * n + 1 ) / 6

		const slope = ( n * sum_xy - sum_x * sum_y ) / ( n * sum_xx - sum_x * sum_x )
		return slope
	
	}

	startMonitoring() {

		if( this.messages.general.startMonitoring ) console.log( this.messages.general.startMonitoring )
		this.isMonitoring       = true
		this.monitoringInterval = setInterval( () => {

			if ( !this.hibernationMode ) {

				this.logPlantStatus()
			
			}
		
		}, 60000 ) // Log every minute

		// Enable keypress detection
		process.stdin.setRawMode( true )
		process.stdin.resume()
		process.stdin.setEncoding( 'utf8' )
		process.stdin.on( 'data', key => {

			if ( key === '\u0003' ) { // Ctrl+C

				process.exit()
			
			} else if ( key === '\u000F' ) { // Ctrl+O

				this.pauseMonitoring()
			
			}
		
		} )
	
	}

	pauseMonitoring() {

		clearInterval( this.monitoringInterval )
		this.isMonitoring = false
		this.displaySensorSettingsMenu()
	
	}

	async displaySensorSettingsMenu() {

		const choices = [
			'Ajustar configuración de sensores',
			'Activar/Desactivar modo de hibernación',
			'Volver a iniciar monitoreo',
			'Salir',
		]

		const { option } = await enquirer.prompt( {
			type    : 'select',
			name    : 'option',
			message : 'Monitoreo detenido. ¿Qué deseas hacer?',
			choices : choices,
		} )

		if ( option === choices[ 0 ] ) {

			await this.adjustSensorSettings()
		
		} else if ( option === choices[ 1 ] ) {

			await this.toggleHibernation()
		
		} else if ( option === choices[ 2 ] ) {

			this.startMonitoring()
		
		} else if ( option === choices[ 3 ] ) {

			console.log( 'Saliendo del menú de ajustes.' )
			process.exit()
		
		}
	
	}

	async adjustSensorSettings() {

		const sensorSettings = await enquirer.prompt( [
			{
				type    : 'input',
				name    : 'humidity',
				message : `Humedad ideal (actual: ${this.plantInfo.humidity.min}-${this.plantInfo.humidity.max}%):`,
				default : `${this.plantInfo.humidity.min}-${this.plantInfo.humidity.max}`,
			},
			{
				type    : 'input',
				name    : 'temperature',
				message : `Temperatura ideal (actual: ${this.plantInfo.temperature.min}-${this.plantInfo.temperature.max}°C):`,
				default : `${this.plantInfo.temperature.min}-${this.plantInfo.temperature.max}`,
			},
			{
				type    : 'input',
				name    : 'light',
				message : `Luz ideal (actual: ${this.plantInfo.lighting.min}-${this.plantInfo.lighting.max} lux):`,
				default : `${this.plantInfo.lighting.min}-${this.plantInfo.lighting.max}`,
			},
		] )

		this.plantInfo.humidity    = this.parseRange( sensorSettings.humidity )
		this.plantInfo.temperature = this.parseRange( sensorSettings.temperature )
		this.plantInfo.lighting    = this.parseRange( sensorSettings.light )

		this.setupAlerts()

		console.log( `Nuevos valores ajustados:
Humedad: ${this.plantInfo.humidity.min}-${this.plantInfo.humidity.max}%
Temperatura: ${this.plantInfo.temperature.min}-${this.plantInfo.temperature.max}°C
Luz: ${this.plantInfo.lighting.min}-${this.plantInfo.lighting.max} lux` )
	
	}

	parseRange( rangeString ) {

		const [ min, max ] = rangeString.split( '-' ).map( Number )
		return {
			min,
			max, 
		}
	
	}

	async toggleHibernation() {

		const { hibernation } = await enquirer.prompt( {
			type    : 'confirm',
			name    : 'hibernation',
			message : '¿Activar modo de hibernación?',
			default : false,
		} )

		this.hibernationMode = hibernation
		console.log( `Modo de hibernación ${this.hibernationMode ? 'activado' : 'desactivado'}.` )
	
	}

	checkAlerts() {

		if ( !this.hasSensors ) return

		for ( const [ sensor, value ] of Object.entries( this.sensors ) ) {

			if ( value === null || value === undefined || isNaN( value ) ) continue
			if ( value < this.alerts[ sensor ].min ) {

				console.log( chalk.red( this.messages.alerts[ sensor ].low.replace( '{value}', value.toFixed( 2 ) ) ) )
			
			} else if ( value > this.alerts[ sensor ].max ) {

				console.log( chalk.red( this.messages.alerts[ sensor ].high.replace( '{value}', value.toFixed( 2 ) ) ) )
			
			}
		
		}
	
	}

}

/**
 * Typed errors so callers can branch on failure kind instead of parsing messages.
 */

export class SmartPlantError extends Error {

	constructor( message, code = 'SMARTPLANT_ERROR', details = {} ) {

		super( message )
		this.name    = 'SmartPlantError'
		this.code    = code
		this.details = details

	}

}

export class SensorError extends SmartPlantError {

	constructor( message, details = {} ) {

		super( message, 'SENSOR_ERROR', details )
		this.name = 'SensorError'

	}

}

export class AIError extends SmartPlantError {

	constructor( message, details = {} ) {

		super( message, 'AI_ERROR', details )
		this.name = 'AIError'

	}

}

export class PluginError extends SmartPlantError {

	constructor( message, details = {} ) {

		super( message, 'PLUGIN_ERROR', details )
		this.name = 'PluginError'

	}

}

export class ConfigError extends SmartPlantError {

	constructor( message, details = {} ) {

		super( message, 'CONFIG_ERROR', details )
		this.name = 'ConfigError'

	}

}

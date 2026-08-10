/**
 * Simulated sensor.
 *
 * This is the driver that makes SmartPlant usable by everyone: no Raspberry Pi,
 * no wiring, no purchase. It models a plant that genuinely dries out over time
 * and a day/night light cycle, so alerts, trends and AI advice all exercise
 * realistic input rather than noise.
 */

import { SensorDriver } from '../driver.js'

export class MockSensor extends SensorDriver {

	static id       = 'mock'
	static provides = [ 'temperature', 'humidity', 'soil', 'light' ]

	/**
	 * @param {object}  [config]              - Options.
	 * @param {number}  [config.temperature]  - Starting temperature (°C).
	 * @param {number}  [config.humidity]     - Starting air humidity (%).
	 * @param {number}  [config.soil]         - Starting soil moisture (%).
	 * @param {number}  [config.dryingRate]   - Soil % lost per read.
	 * @param {boolean} [config.dayNight]     - Model a light cycle from the clock.
	 * @param {number}  [config.seed]         - Seed for reproducible runs.
	 */
	constructor( config = {} ) {

		super( {
			id : MockSensor.id,
			...config,
		} )

		this.state = {
			temperature : config.temperature ?? 21,
			humidity    : config.humidity ?? 55,
			soil        : config.soil ?? 65,
			light       : config.light ?? 400,
		}
		this.dryingRate = config.dryingRate ?? 0.8
		this.dayNight   = config.dayNight ?? true
		this._seed      = config.seed ?? 42
		this.reads      = 0

	}

	/** Deterministic PRNG (mulberry32) so tests and demos are reproducible. */
	_rand() {

		this._seed = ( this._seed + 0x6D2B79F5 ) | 0
		let t = this._seed
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 )
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 )
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296

	}

	_drift( amount ) {

		return ( this._rand() - 0.5 ) * amount

	}

	async read() {

		this.reads++
		const s = this.state

		// Soil dries monotonically until something waters it.
		s.soil = Math.max( 0, s.soil - this.dryingRate + this._drift( 0.3 ) )
		// Air humidity loosely tracks the soil.
		s.humidity = clamp( s.humidity + ( s.soil - s.humidity ) * 0.05 + this._drift( 2 ), 5, 95 )
		s.temperature = clamp( s.temperature + this._drift( 0.6 ), 5, 40 )

		if ( this.dayNight ) {

			// Sine over a 24h clock: dark at night, peak at midday.
			const hour  = new Date().getHours() + new Date().getMinutes() / 60
			const curve = Math.max( 0, Math.sin( ( ( hour - 6 ) / 12 ) * Math.PI ) )
			s.light = Math.round( curve * 900 + this._drift( 40 ) )

		}
		else s.light = clamp( s.light + this._drift( 50 ), 0, 1200 )

		return this.normalize( {
			temperature : round( s.temperature, 1 ),
			humidity    : round( s.humidity, 1 ),
			soil        : round( s.soil, 1 ),
			light       : Math.max( 0, Math.round( s.light ) ),
		} )

	}

	/** Simulate a watering, so `plant.water()` visibly changes the readings. */
	water( amount = 30 ) {

		this.state.soil = clamp( this.state.soil + amount, 0, 100 )
		return this.state.soil

	}

	/**
	 * Resume from a previously stored reading.
	 *
	 * Without this the simulation resets on every process start, so a short-lived
	 * CLI command always reports the same numbers and a watering appears to do
	 * nothing. The kernel calls this after loading memory.
	 *
	 * @param   {object} reading - A stored reading.
	 * @returns {MockSensor}     this
	 */
	restore( reading ) {

		if ( !reading ) return this
		for ( const key of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

			if ( Number.isFinite( reading[ key ] ) ) this.state[ key ] = reading[ key ]

		}
		return this

	}

}

const clamp = ( v, lo, hi ) => Math.min( Math.max( v, lo ), hi )
const round = ( v, d ) => Number( v.toFixed( d ) )

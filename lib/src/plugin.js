/**
 * Plugin authoring helper.
 *
 * A SmartPlant plugin is just an object with a `name` and an `init(plant)`.
 * `definePlugin` removes the boilerplate around that: it wires event listeners,
 * binds `this.plant`, and gives every plugin a consistent `ask()` that goes
 * through the kernel's context + structured-output pipeline.
 *
 * @example
 * export default definePlugin( {
 *   name   : 'watering',
 *   schema : { advice: '', emoji: '💧', daysUntilWater: 0 },
 *   on     : {
 *     'plant:thirsty' : async function ( e ) { console.log( await this.predict() ) },
 *   },
 *   methods : {
 *     async predict( input ) {
 *       return this.ask( 'When should this plant next be watered?', { extra: input } )
 *     },
 *   },
 * } )
 */

import { PluginError } from './core/errors.js'

/**
 * @param   {object}   spec              - Plugin definition.
 * @param   {string}   spec.name         - Unique plugin name.
 * @param   {string}   [spec.description]- Human description.
 * @param   {object}   [spec.schema]     - Default JSON shape for `ask()`.
 * @param   {string}   [spec.persona]    - Persona override for this plugin's calls.
 * @param   {object}   [spec.methods]    - Methods, called with the plugin as `this`.
 * @param   {object}   [spec.on]         - Event name → listener (bound to the plugin).
 * @param   {Function} [spec.setup]      - Extra init logic, `(plant, options)`.
 * @returns {object}                     The plugin.
 */
export function definePlugin( spec ) {

	if ( !spec?.name ) throw new PluginError( 'definePlugin() requires a `name`.' )

	const plugin = {
		name        : spec.name,
		description : spec.description || '',
		schema      : spec.schema || {
			advice   : '',
			emoji    : '🌿',
			severity : 'low',
		},
		persona     : spec.persona,
		plant       : null,
		options     : {},
		_off        : [],

		/**
		 * Ask the AI a question with the plant's full context injected.
		 *
		 * @param   {string}          question - The question.
		 * @param   {object}          [opts]   - Options forwarded to `plant.analyze`.
		 * @returns {Promise<object>}          Structured answer.
		 */
		async ask( question, opts = {} ) {

			if ( !this.plant ) throw new PluginError( `Plugin "${this.name}" is not installed on a plant yet.` )
			return this.plant.analyze( question, {
				schema  : opts.schema || this.schema,
				persona : opts.persona || this.persona,
				...opts,
			} )

		},

		/** Shorthand for the current context. */
		context() {

			return this.plant.context()

		},

		async init( plant, options = {} ) {

			this.plant   = plant
			this.options = options

			for ( const [ event, fn ] of Object.entries( spec.on || {} ) ) {

				this._off.push( plant.on( event, fn.bind( this ) ) )

			}

			if ( typeof spec.setup === 'function' ) await spec.setup.call( this, plant, options )
			return this

		},

		/** Detach listeners. Called by `plant.destroy()`. */
		async destroy() {

			for ( const off of this._off ) off()
			this._off = []
			if ( typeof spec.teardown === 'function' ) await spec.teardown.call( this )

		},
	}

	for ( const [ key, fn ] of Object.entries( spec.methods || {} ) ) {

		if ( key in plugin ) throw new PluginError( `Plugin "${spec.name}" cannot override the reserved method "${key}".` )
		plugin[ key ] = fn

	}

	return plugin

}

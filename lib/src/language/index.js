/**
 * Message catalogue.
 *
 * Registers every shipped locale — including `nl`, which had a translation file
 * but was missing from the 1.x lookup map, so selecting Dutch silently fell back
 * to English.
 */

import MsgDe from './messages-de.js'
import MsgEn from './messages-en.js'
import MsgEs from './messages-es.js'
import MsgFr from './messages-fr.js'
import MsgIt from './messages-it.js'
import MsgJa from './messages-ja.js'
import MsgNl from './messages-nl.js'
import MsgPt from './messages-pt.js'
import MsgRu from './messages-ru.js'
import MsgZh from './messages-zh.js'

export const MESSAGES = {
	de : MsgDe,
	en : MsgEn,
	es : MsgEs,
	fr : MsgFr,
	it : MsgIt,
	ja : MsgJa,
	nl : MsgNl,
	pt : MsgPt,
	ru : MsgRu,
	zh : MsgZh,
}

/** Locale code → the name the AI should answer in. */
export const LANGUAGE_NAMES = {
	de : 'German',
	en : 'English',
	es : 'Spanish',
	fr : 'French',
	it : 'Italian',
	ja : 'Japanese',
	nl : 'Dutch',
	pt : 'Portuguese',
	ru : 'Russian',
	zh : 'Chinese',
}

export const LANGUAGES = Object.keys( MESSAGES )

/**
 * Load a catalogue, falling back to English.
 *
 * Accepts `'es-ES'` as well as `'es'`, since that is what `navigator.language`
 * and most shells report.
 *
 * @param   {string} [lang] - Locale code.
 * @returns {object}        Message catalogue.
 */
export function loadMessages( lang = 'en' ) {

	const base = String( lang ).toLowerCase().split( /[-_]/ )[ 0 ]
	return withMetricAliases( MESSAGES[ base ] || MESSAGES.en )

}

/**
 * The catalogues key soil alerts under `moisture`, but the sensor layer calls
 * that metric `soil` and has a separate `humidity`. 1.x looked up
 * `messages.alerts[sensor]` with the sensor name and got `undefined` for both,
 * crashing every alert. Rather than break ten translation files, expose the
 * metric names as aliases onto the same strings.
 *
 * @param   {object} catalogue - Raw message catalogue.
 * @returns {object}           Catalogue with metric-name aliases.
 */
function withMetricAliases( catalogue ) {

	if ( catalogue.__aliased ) return catalogue

	const alerts = catalogue.alerts || {}
	if ( alerts.moisture ) {

		alerts.soil     = alerts.soil || alerts.moisture
		alerts.humidity = alerts.humidity || alerts.moisture

	}

	Object.defineProperty( catalogue, '__aliased', {
		value      : true,
		enumerable : false,
	} )
	return catalogue

}

/**
 * Interpolate `{placeholders}` in a message.
 *
 * @param   {string} template - Message template.
 * @param   {object} [vars]   - Replacement values.
 * @returns {string}          Rendered message.
 */
export function t( template, vars = {} ) {

	if ( typeof template !== 'string' ) return ''
	return template.replace( /\{(\w+)\}/g, ( m, key ) => ( key in vars ? String( vars[ key ] ) : m ) )

}

/**
 * Persona — the "closer communication" half of the bridge.
 *
 * A monitoring tool reports "humidity 22%". A companion says "I'm parched — it's
 * been nine days." Same data, different relationship. This module owns that
 * translation: system prompts that put the plant in first person, plus the
 * deterministic emoji scales so the feeling is legible even with the AI offline.
 */

import { METRICS } from '../sensors/driver.js'

/** Available voices. `tone` is injected into the system prompt. */
export const PERSONAS = {
	plant : {
		label  : 'The plant itself',
		system : 'You ARE the plant. Speak in first person, warmly and briefly, as a living thing describing how it feels. Never mention sensors, data, models or percentages — translate them into sensation ("my soil is bone dry", "the light barely reaches me"). Never invent readings you were not given.',
	},
	botanist : {
		label  : 'Practical botanist',
		system : 'You are an experienced, plain-spoken botanist advising the plant\'s owner. Be concrete and actionable. Prefer one clear next step over a list of possibilities. No filler, no hedging.',
	},
	poet : {
		label  : 'Poetic',
		system : 'You are the plant, speaking in short, vivid, image-led lines. Keep it under 40 words. Beauty is welcome; invented facts are not.',
	},
	scientist : {
		label  : 'Data-first',
		system : 'You are a plant physiologist. Reference the actual measured values and trends, state confidence honestly, and flag when data is insufficient to conclude anything.',
	},
	child : {
		label  : 'Simple and friendly',
		system : 'Explain the plant\'s state the way you would to a curious ten-year-old: short sentences, no jargon, encouraging tone.',
	},
}

export const DEFAULT_PERSONA = 'plant'

/** Wellbeing → face. Deterministic, works with no AI at all. */
export function happinessEmoji( score ) {

	if ( !Number.isFinite( score ) ) return '❔'
	if ( score >= 90 ) return '🤩'
	if ( score >= 75 ) return '😊'
	if ( score >= 60 ) return '🙂'
	if ( score >= 45 ) return '😐'
	if ( score >= 30 ) return '😟'
	if ( score >= 15 ) return '😣'
	return '😵'
}

/** Per-metric emoji, chosen from the comfort score and the direction of the miss. */
export function metricEmoji( metric, value, range ) {

	if ( !Number.isFinite( value ) ) return '❔'
	const low  = range && value < range.min
	const high = range && value > range.max

	switch ( metric ) {

		case 'soil':
		case 'humidity':
			if ( low ) return '🏜️'
			if ( high ) return '🌊'
			return '💧'
		case 'light':
			if ( low ) return '🌑'
			if ( high ) return '🔆'
			return '🌞'
		case 'temperature':
			if ( low ) return '🥶'
			if ( high ) return '🔥'
			return '🌡️'
		case 'ph':
			if ( low ) return '🍋'
			if ( high ) return '🧼'
			return '⚗️'
		case 'conductivity':
			if ( low ) return '🥄'
			if ( high ) return '🧂'
			return '⚡'
		default:
			return '🌿'

	}

}

/**
 * One-line status bar. The zero-cost, zero-latency view of the plant.
 *
 * @param   {object} ctx - Result of `buildContext`.
 * @returns {string}     Rendered line.
 */
export function statusLine( ctx ) {

	const parts = []
	for ( const [ metric, meta ] of Object.entries( METRICS ) ) {

		const value = ctx.current?.[ metric ]
		if ( !Number.isFinite( value ) ) continue
		parts.push( `${meta.label}: ${metricEmoji( metric, value, ctx.ranges?.[ metric ] )} ${value}${meta.unit}` )

	}

	const face = happinessEmoji( ctx.happiness )
	if ( !parts.length ) return `${face} | no sensor data`
	return `${face} ${ctx.happiness}% | ${parts.join( ' | ' )}`

}

/**
 * Build the system prompt for a call.
 *
 * @param   {object} opts             - Options.
 * @param   {string} [opts.persona]   - Persona id.
 * @param   {string} [opts.language]  - Reply language.
 * @param   {string} [opts.extra]     - Extra instruction appended last.
 * @returns {string}                  System prompt.
 */
export function systemPrompt( {
	persona = DEFAULT_PERSONA, language, extra,
} = {} ) {

	const p = PERSONAS[ persona ] || PERSONAS[ DEFAULT_PERSONA ]
	return [
		p.system,
		language ? `Reply in ${language}.` : null,
		'Base every statement strictly on the CONTEXT provided. If the data does not support a claim, say what you do not know instead of guessing.',
		extra,
	].filter( Boolean ).join( '\n' )

}

/**
 * Deterministic fallback sentence, used when no AI is configured or a call fails.
 * The library must always be able to say *something* true.
 *
 * @param   {object} ctx - Result of `buildContext`.
 * @returns {string}     A sentence.
 */
export function offlineVoice( ctx ) {

	const name = ctx.plant?.name || 'Your plant'
	const worst = ctx.deviations?.[ 0 ]

	if ( !ctx.current || !Object.keys( ctx.current ).length ) {

		return `${name}: no readings yet — connect a sensor or use the mock driver to start.`

	}

	if ( !worst ) {

		const water = ctx.care?.daysSinceWater
		return `${name} is comfortable right now (${ctx.happiness}/100).${water != null ? ` Last watered ${water} day(s) ago.` : ''}`

	}

	const label = METRICS[ worst.metric ]?.label || worst.metric
	const dir   = worst.direction === 'low' ? 'below' : 'above'
	return `${name} needs attention: ${label.toLowerCase()} is ${worst.value}${worst.unit}, ${dir} the ideal ${worst.range.min}-${worst.range.max}${worst.unit}.`

}

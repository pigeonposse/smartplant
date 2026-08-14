/**
 * Talking with light, when there is no other way to talk.
 *
 * The spectral module drives LEDs at a plant to measure what comes back. The
 * same hardware can be switched fast enough to carry data, which turns a
 * diagnostic instrument into a transmitter: on-off keying in the amber channel,
 * decoded by a neighbour's photodiode. Visible light communication is ordinary
 * engineering and none of it is speculative.
 *
 * What *is* worth being careful about is when it earns its place, because the
 * obvious argument for it is wrong.
 *
 * ## The energy argument, stated correctly
 *
 * It is tempting to say an LED pulse costs a hundredth of a radio packet. It
 * does not. A BLE advertisement is one of the cheapest things a battery-powered
 * device can do — a few milliamps for a couple of milliseconds, then the radio
 * sleeps. Per bit delivered, blinking an LED is *worse*.
 *
 * The real argument is narrower and it holds:
 *
 *   · Keeping a Wi-Fi association alive is expensive in a way an advertisement
 *     is not, and a node with minutes of charge left cannot afford to associate.
 *   · A radio that has **failed** transmits nothing at any price. No power
 *     budget makes a dead antenna work.
 *   · In total darkness the optical channel has an enormous signal-to-noise
 *     ratio for free, so the same information costs fewer, dimmer pulses at
 *     night than it ever could in daylight.
 *
 * So this is a fallback and a night channel. It is not a better radio, and
 * presenting it as one would be selling a worse link on a false premise.
 *
 * ## The half everyone forgets
 *
 * A transmitter is useless without a receiver that can follow it. An ambient
 * light sensor integrates over hundreds of milliseconds and reports about once
 * a second — correct for measuring daylight, hopeless for anything modulated.
 * Sampling at 1 Hz cannot recover a signal switching faster than 0.5 Hz, and no
 * cleverness at the sending end changes that.
 *
 * So nothing here transmits until a neighbour has *declared a photodiode fast
 * enough to decode it*. A plant spending its last charge blinking at a lux
 * sensor has not called for help. It has thrown the charge away and, worse,
 * believes it was heard.
 *
 * ## It is still light landing on a plant
 *
 * The dark-hours interlock exists because light at night disrupts a plant's
 * rhythm, and a message is not exempt from that. Amber at 590 nm is the right
 * carrier for the same reason it is the spectral module's control channel —
 * minimal photosynthetic and photomorphogenic effect — but "minimal" is not
 * "none". Every transmission is booked against the receiving plant's own dose
 * ledger like any other emission, and the budget below is small enough that a
 * full night of beaconing stays far under a probe.
 */

import { FACULTY, opticalLink } from './capability.js'

/** When the optical channel is allowed to run at all. */
export const BEACON = {
	OFF      : 'off',
	CRITICAL : 'critical',
	QUIET    : 'quiet',
}

/** Battery fraction below which the radios come down and the light comes up. */
export const CRITICAL_CHARGE = 0.05

/** Ambient light below which the channel counts as having darkness to work with. */
export const DARK_LUX = 1

/**
 * Carriers, and why each one.
 *
 * Amber is the default for the same reason the spectral module uses it as a
 * control: it moves a plant least. Green is the fallback for a sender buried in
 * a canopy, because green penetrates leaf tissue rather than being absorbed at
 * the surface — the property that makes it a poor photosynthetic driver is
 * exactly what makes it a better carrier through foliage.
 */
export const CARRIER = {
	amber : {
		nm : 590,
		why : 'Minimal perturbation. The same reason this is the spectral control channel — it can be pulsed at a resting plant at night without pulling it out of its rhythm.',
	},
	green : {
		nm : 530,
		why : 'Penetrates leaf tissue instead of being absorbed at the surface, so it reaches a receiver through foliage. Used only when the sender is obstructed, because it perturbs more than amber.',
	},
}

/** Pulse budget. Deliberately frugal — this is a distress channel, not a link. */
export const PULSE = {
	widthMs : 2,
	gapMs : 8,
	level : 0.25,
	// Seconds of actual emission per transmission, at the duty cycle above.
	// A full night of these totals a few seconds of amber at quarter power.
	dutyCycle : 0.2,
}

const finite = Number.isFinite

/**
 * Should the optical channel be running?
 *
 * Two states and nothing else. In ordinary daylight operation a plant has
 * radios, and a slower channel that costs the neighbour's rhythm has no claim
 * on the situation.
 *
 * @param   {object}  s              - `{charge, radioFailed, ambientLux}`.
 * @returns {object}                 `{mode, active, why}`.
 */
export function beaconMode( s = {} ) {
	s = s ?? {}

	const critical = ( finite( s.charge ) && s.charge <= CRITICAL_CHARGE ) || s.radioFailed === true

	if ( critical ) {

		return {
			mode : BEACON.CRITICAL,
			active : true,
			why : s.radioFailed
				? 'The radio has failed. No power budget makes a dead antenna work, so the only channel left is the one built from the lamp.'
				: `Charge is at ${Math.round( ( s.charge ?? 0 ) * 100 )}%. Radios down — keeping a Wi-Fi association alive is what would spend the remainder — and the residual charge goes to pulses instead. The point is to not die silently.`,
		}

	}

	if ( finite( s.ambientLux ) && s.ambientLux <= DARK_LUX ) {

		return {
			mode : BEACON.QUIET,
			active : true,
			why : `Dark at ${s.ambientLux} lux. The optical channel has almost no noise to compete with, so the same message costs fewer and dimmer pulses now than at any other time. Light telemetry only — anything that matters travels by radio in the morning.`,
		}

	}

	return {
		mode : BEACON.OFF,
		active : false,
		why : finite( s.ambientLux )
			? `Nothing here calls for it: charge is fine and there is ${s.ambientLux} lux of daylight to compete with. Radio is faster, cheaper per bit, and does not put light on a neighbour. The optical channel is a fallback and a night channel, not a better link.`
			: 'Nothing here calls for it. The optical channel is a fallback and a night channel, not a better link.',
	}

}

/**
 * Frame a message for on-off keying.
 *
 * A preamble to lock onto, the sender's identity, a short payload and a
 * checksum. Nothing sophisticated — the channel is slow and the messages are
 * tiny, and an unacknowledged link should carry as little as it can get away
 * with rather than as much as it can fit.
 *
 * @param   {object} msg - `{from, kind, body}`.
 * @returns {object}     `{bits, frame, ms}`.
 */
export function frame( msg = {} ) {
	msg = msg ?? {}

	// Alternating preamble: the receiver has no clock shared with the sender, so
	// it recovers timing from the edges of a known pattern before anything that
	// carries meaning arrives.
	const preamble = [ 1, 0, 1, 0, 1, 0, 1, 1 ]

	const payload = JSON.stringify( {
		f : msg.from ?? '?',
		k : msg.kind ?? 'sos',
		b : msg.body ?? {},
	} )

	const bytes = [ ...payload ].map( c => c.codePointAt( 0 ) & 0xff )
	const checksum = bytes.reduce( ( a, b ) => ( a + b ) & 0xff, 0 )

	const toBits = b => Array.from( { length : 8 }, ( _, i ) => ( b >> ( 7 - i ) ) & 1 )

	const bits = [
		...preamble,
		...toBits( bytes.length & 0xff ),
		...bytes.flatMap( toBits ),
		...toBits( checksum ),
	]

	return {
		bits,
		bytes : bytes.length,
		checksum,
		payload,
		// Wall time the whole frame occupies, which is what the energy estimate
		// and the dose booking both need.
		ms : bits.length * ( PULSE.widthMs + PULSE.gapMs ),
	}

}

/**
 * Decode a frame back, for a receiver that sampled the pulses.
 *
 * @param   {number[]} bits - Recovered bits.
 * @returns {object}        `{ok, message, why}`.
 */
export function decode( bits = [] ) {
	bits = bits ?? []

	const start = findPreamble( bits )

	if ( start < 0 ) return {
		ok : false,
		why : 'No preamble found. Either nothing was transmitting or the sampling was too slow to catch the edges — and from the receiver\'s side those look identical, which is why the sender checks the receiver\'s sample rate before it starts.',
	}

	const rest = bits.slice( start )
	const byteAt = i => rest.slice( i * 8, i * 8 + 8 ).reduce( ( a, b ) => ( a << 1 ) | b, 0 )

	const length = byteAt( 0 )
	const bytes = Array.from( { length }, ( _, i ) => byteAt( i + 1 ) )
	const checksum = byteAt( length + 1 )
	const computed = bytes.reduce( ( a, b ) => ( a + b ) & 0xff, 0 )

	if ( checksum !== computed ) return {
		ok : false,
		why : `Checksum mismatch: ${computed} against ${checksum}. Something was received and it is not intact. An unacknowledged channel cannot ask for a resend, so a corrupt frame is dropped rather than half-believed.`,
	}

	try {

		const parsed = JSON.parse( String.fromCodePoint( ...bytes ) )

		return {
			ok : true,
			message : {
				from : parsed.f,
				kind : parsed.k,
				body : parsed.b,
			},
			why : `Frame intact from "${parsed.f}".`,
		}

	}
	catch {

		return {
			ok : false,
			why : 'Checksum passed but the payload is not readable. Treated as a failure rather than guessed at.',
		}

	}

}

function findPreamble( bits ) {

	const p = [ 1, 0, 1, 0, 1, 0, 1, 1 ]

	for ( let i = 0; i + p.length <= bits.length; i++ ) {

		if ( p.every( ( b, j ) => bits[ i + j ] === b ) ) return i + p.length

	}

	return -1

}

/**
 * Decide whether to transmit, and prepare it.
 *
 * Every refusal here is a real one, and the receiver check is the one that
 * matters most: it is the difference between calling for help and believing you
 * called for help.
 *
 * @param   {object} sender    - Sender's manifest.
 * @param   {object} receiver  - Receiver's manifest, or null for a broadcast.
 * @param   {object} msg       - `{kind, body}`.
 * @param   {object} [opts]    - `{ mode, obstructed }`.
 * @returns {object}           `{send, frame, band, why}`.
 */
export function prepare( sender, receiver, msg = {}, opts = {} ) {
	msg = msg ?? {}
	opts = opts ?? {}

	if ( opts.mode === BEACON.OFF || !opts.mode ) {

		return {
			send : false,
			why : 'The optical channel is not in either state that justifies it. Use the radio.',
		}

	}

	const link = opticalLink( sender, receiver )

	if ( !link.can ) {

		return {
			send : false,
			reason : link.reason,
			why : link.why,
		}

	}

	const band = opts.obstructed ? 'green' : 'amber'
	const f = frame( {
		from : sender.id,
		kind : msg.kind,
		body : msg.body,
	} )

	return {
		send : true,
		band,
		nm : CARRIER[ band ].nm,
		frame : f,
		to : receiver.id,
		// Booked like any other emission. A message is still light landing on a
		// plant, and the ledger is what stops a night of them adding up unseen.
		dose : {
			band,
			seconds : Number( ( ( f.ms / 1000 ) * PULSE.dutyCycle ).toFixed( 3 ) ),
			level : PULSE.level,
		},
		why : `${f.bytes} bytes over ${band} at ${CARRIER[ band ].nm} nm, ${( f.ms / 1000 ).toFixed( 1 )}s of wall time and ${( ( f.ms / 1000 ) * PULSE.dutyCycle ).toFixed( 2 )}s of actual emission. ${CARRIER[ band ].why} ${link.why}`,
	}

}

/**
 * The message a plant sends when it is about to go dark.
 *
 * Deliberately minimal. There is no acknowledgement on this channel and no
 * second chance, so it carries what a neighbour needs in order to raise the
 * alarm on its behalf and nothing else.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       `{kind, body}`.
 */
export function distress( plant ) {

	const last = plant?.memory?.lastReading ?? {}

	return {
		kind : 'sos',
		body : {
			c : plant?.power?.charge ?? null,
			s : finite( last.soil ) ? Math.round( last.soil ) : null,
			t : finite( last.temperature ) ? Math.round( last.temperature ) : null,
		},
	}

}

/**
 * What a plant does on receiving a distress frame.
 *
 * The receiving plant is not being asked to do anything to the sender. It is
 * being asked to be its radio — to take a message from a node that can no longer
 * reach the network and put it on the network.
 *
 * @param   {object} message - Decoded message.
 * @returns {object}         `{relay, why}`.
 */
export function onDistress( message ) {

	if ( message?.kind !== 'sos' ) return {
		relay : false,
		why : 'Not a distress frame.',
	}

	const charge = message.body?.c

	return {
		relay : true,
		from : message.from,
		charge,
		why : `"${message.from}" is about to lose power${finite( charge ) ? ` at ${Math.round( charge * 100 )}% charge` : ''} and has come down to its lamp to say so. Relaying it to the network: this plant still has a radio and that one does not, which is the entire reason the message was sent by light. Nothing is being done *to* the sender — a neighbour cannot charge it — but a person can, and now can be told.`,
	}

}

export { FACULTY }

/**
 * Lamps, and what to actually emit for each job.
 *
 * The spectral layer knew which wavelength interrogates which photoreceptor and
 * had nothing to say about the hardware that produces it. `emit({ blue: 0.5 })`
 * went to a driver, and what the plant received depended entirely on a fixture
 * the library had never been told about.
 *
 * So this is two things. A catalogue of the lamps people actually use, with
 * which channels they have and what each channel really emits — a "blue" channel
 * is 440nm on one fixture and 470nm on another, and phototropins care about the
 * difference. And a recipe per job: what to drive, how hard, for how long, and
 * with what ramp.
 *
 * ## Level is not intensity, and this file will not pretend otherwise
 *
 * A driver level of 0.5 is a duty cycle. What reaches the leaf depends on the
 * fixture's output, how far away it is, its beam angle and what else is in the
 * room — a factor easily of ten between two setups running the same number.
 *
 * Every recipe therefore states the level to drive **and** that the delivered
 * dose is unknown without measuring it. A PAR sensor closes that loop; nothing
 * else does. Estimating µmol/m²/s from a level and a datasheet would produce a
 * confident figure with an error nobody could see, which is worse than the
 * honest admission that the number is a request rather than a measurement.
 *
 * ## Probing and treating are different jobs
 *
 * A probe asks a question: the smallest stimulus that produces a readable
 * response, kept deliberately weak because the point is to measure the plant and
 * not to move it. A treatment intends to change something, and answers to the
 * dose ledger and the contraindications.
 *
 * They are separated here so that no probe recipe can quietly become a
 * treatment by being run for longer.
 */

/** What a channel actually emits, by fixture family. */
export const CHANNELS = {
	royalBlue : {
		nm : 450,
		label : 'Royal blue',
		drives : [ 'cryptochrome', 'phototropin' ],
	},
	blue      : {
		nm : 470,
		label : 'Blue',
		drives : [ 'cryptochrome' ],
	},
	green     : {
		nm : 525,
		label : 'Green',
		drives : [ 'deep mesophyll penetration' ],
	},
	amber     : {
		nm : 590,
		label : 'Amber',
		drives : [ 'almost nothing — the control channel' ],
	},
	red       : {
		nm : 660,
		label : 'Deep red',
		drives : [ 'photosystem II', 'phytochrome Pr→Pfr' ],
	},
	farRed    : {
		nm : 730,
		label : 'Far red',
		drives : [ 'phytochrome Pfr→Pr' ],
	},
	uvA       : {
		nm : 385,
		label : 'UV-A',
		drives : [ 'cryptochrome', 'UVR8 edge' ],
	},
	white     : {
		nm : null,
		label : 'White (broad)',
		drives : [ 'everything at once — useless as a probe' ],
	},
}

/**
 * Fixtures people actually own.
 *
 * As with the device catalogue, none of these has been tested against the
 * physical part. What is catalogued is which channels each family exposes and
 * roughly what those channels emit, which is the part that decides whether a
 * probe is asking the right question at all.
 */
export const FIXTURES = {

	'rgb-strip' : {
		label    : 'RGB LED strip (WS2812 / SK6812)',
		channels : [ 'blue', 'green', 'red' ],
		probes   : [ 'blue', 'green', 'red' ],
		notes    : 'Cheap and everywhere. The red is usually around 620–630nm rather than the 660nm photosystem II actually wants, so red readings from one of these are weaker than they should be — real, but attenuated. No far-red, so phytochrome state cannot be probed at all.',
		caveats  : [ 'red is 620-630nm, not 660nm', 'no far-red channel' ],
	},

	'rgbw-strip' : {
		label    : 'RGBW LED strip',
		channels : [ 'blue', 'green', 'red', 'white' ],
		probes   : [ 'blue', 'green', 'red' ],
		notes    : 'The white channel is useful for growing and useless for probing: it drives every photoreceptor at once, so the response cannot be attributed to any of them.',
		caveats  : [ 'white is not a probe channel' ],
	},

	'horticultural-4ch' : {
		label    : 'Horticultural 4-channel (royal blue / red / far-red / white)',
		channels : [ 'royalBlue', 'red', 'farRed', 'white' ],
		probes   : [ 'royalBlue', 'red', 'farRed' ],
		notes    : 'Built for plants rather than for eyes: 450nm and 660nm are where the photoreceptors are, and the far-red channel makes the phytochrome probe possible. The one worth having if the spectral system is the point.',
		caveats  : [ 'no green channel, so the deep-mesophyll probe is unavailable', 'no amber, so the control runs as a sham' ],
	},

	'horticultural-6ch' : {
		label    : 'Horticultural 6-channel (+ green, UV-A)',
		channels : [ 'uvA', 'royalBlue', 'green', 'red', 'farRed', 'white' ],
		probes   : [ 'uvA', 'royalBlue', 'green', 'red', 'farRed' ],
		notes    : 'Every probe this library can run. UV-A is included for completeness and is the one channel where the treatment risk genuinely exceeds the diagnostic value for most people.',
		caveats  : [ 'UV-A needs eye protection during any manual work under it', 'no amber, so the control runs as a sham' ],
	},

	'single-white' : {
		label    : 'Single-channel white grow light',
		channels : [ 'white' ],
		probes   : [],
		notes    : 'Grows plants perfectly well and cannot probe anything. A broad-spectrum pulse drives every photoreceptor simultaneously, so the electrical response cannot be attributed to any one of them — which is the whole basis of the spectral method.',
		caveats  : [ 'no probing is possible with this fixture' ],
	},

}

/**
 * What to emit for each job.
 *
 * Probe levels are deliberately low: the aim is the smallest stimulus that
 * produces a readable response. Treatment levels are higher and answer to the
 * dose ledger, which is the layer that decides whether they may run at all.
 */
export const RECIPES = {

	blue : {
		probe : {
			channel : [ 'royalBlue', 'blue' ],
			level   : 0.35,
			// Square modulation at the band's own period, not a steady light: the
			// analysis recovers the response by locking to that frequency, and a
			// constant stimulus gives it nothing to lock to.
			shape   : 'square',
			rampMs  : 800,
			why     : 'Enough to open guard cells measurably, well below the level that would force them open against ABA. A soft ramp avoids the startle response that a hard edge produces, which would sit on top of the signal being measured.',
		},
		treat : {
			channel : [ 'royalBlue', 'blue' ],
			level   : 0.7,
			shape   : 'steady',
			rampMs  : 3000,
			why     : 'Forces stomatal opening. Gated by the dose ledger and refused outright on a water-stressed plant, where opening stomata overrides the protection ABA is providing.',
		},
	},

	red : {
		probe : {
			channel : [ 'red' ],
			level   : 0.4,
			shape   : 'square',
			rampMs  : 800,
			why     : 'Drives photosystem II hard enough to read the response without saturating it — a saturated response is flat and says nothing about capacity.',
		},
		treat : {
			channel : [ 'red' ],
			level   : 0.8,
			shape   : 'steady',
			rampMs  : 3000,
			why     : 'Photosynthetic drive. The workhorse channel for actually growing a plant.',
		},
	},

	green : {
		probe : {
			channel : [ 'green' ],
			level   : 0.5,
			shape   : 'square',
			rampMs  : 800,
			why     : 'Green is largely reflected by the upper canopy, which is exactly why it reaches the mesophyll underneath. Driven a little harder than blue or red because most of it never arrives.',
		},
		treat : null,
	},

	farRed : {
		probe : {
			channel : [ 'farRed' ],
			level   : 0.3,
			shape   : 'square',
			rampMs  : 800,
			why     : 'Shifts phytochrome toward Pr. Low level and short: far-red is how a plant decides it is being shaded, and a heavy dose triggers stretching that takes weeks to undo.',
		},
		treat : {
			channel : [ 'farRed' ],
			level   : 0.4,
			shape   : 'steady',
			rampMs  : 2000,
			why     : 'Used deliberately at end of day to accelerate the shift to night. Easy to misuse — this is the channel that makes a plant leggy.',
		},
	},

	// The control the whole method rests on. Horticultural fixtures almost never
	// carry amber, so where it is missing the honest substitute is no light at
	// all: command the lamp, do not light it, and record what happens anyway.
	// That still catches everything except the light itself — driver pickup on
	// the electrode, the timing of the sequence, heat from the supply — which is
	// most of what a control is for.
	amber : {
		probe : {
			channel : [ 'amber' ],
			fallback : 'sham',
			level   : 0.4,
			shape   : 'square',
			rampMs  : 800,
			why     : 'The control. Amber drives almost no photoreceptor, so a response to it is a response to the *act* of illuminating — heat, startle, electrical pickup from the driver. Every other band is only interpretable against this one.',
		},
		treat : null,
	},

	uvA : {
		probe : {
			channel : [ 'uvA' ],
			level   : 0.2,
			shape   : 'square',
			rampMs  : 1500,
			why     : 'Lowest level of any probe. UV is a stressor at doses that barely register as light, and the diagnostic value does not justify much of it.',
		},
		treat : null,
	},

}

/**
 * Resolve a recipe against a real fixture.
 *
 * @param   {string} band     - Band id.
 * @param   {string} mode     - `'probe'` | `'treat'`.
 * @param   {string|object} fixture - Fixture id or `{channels}`.
 * @returns {object}          `{usable, emit, channel, why}`.
 */
export function recipe( band, mode, fixture ) {

	const spec = RECIPES[ band ]?.[ mode ]

	if ( !spec ) {

		return {
			usable : false,
			why : RECIPES[ band ]
				? `There is no ${mode} recipe for ${band}. ${mode === 'treat' ? 'This band is diagnostic only — it is used to ask a question, not to change anything.' : ''}`.trim()
				: `No such band "${band}".`,
		}

	}

	const profile = typeof fixture === 'string' ? FIXTURES[ fixture ] : fixture

	if ( !profile ) {

		return {
			usable : false,
			why : `Unknown fixture "${fixture}". One of: ${Object.keys( FIXTURES ).join( ', ' )}.`,
		}

	}

	const available = profile.channels || []
	const channel = spec.channel.find( c => available.includes( c ) )

	if ( !channel && spec.fallback === 'sham' ) {

		return {
			usable : true,
			band,
			mode,
			channel : null,
			sham    : true,
			emit    : {},
			level   : 0,
			shape   : spec.shape,
			rampMs  : spec.rampMs,
			delivered : null,
			why : `This fixture has no amber channel, which most horticultural fixtures do not. Running the control as a sham instead: the sequence executes and the lamp stays dark. That still tests everything except the light — electrical pickup from the driver, the timing itself, heat from the supply — which is most of what the control exists to rule out.`,
		}

	}

	if ( !channel ) {

		return {
			usable : false,
			wanted : spec.channel,
			has : available,
			why : `This fixture has no ${spec.channel.join( ' or ' )} channel, so the ${band} ${mode} cannot be run on it. ${profile.notes || ''}`.trim(),
		}

	}

	const exact = spec.channel[ 0 ]
	const substituted = channel !== exact

	return {
		usable  : true,
		band,
		mode,
		channel,
		nm      : CHANNELS[ channel ]?.nm ?? null,
		emit    : { [ channel ] : spec.level },
		level   : spec.level,
		shape   : spec.shape,
		rampMs  : spec.rampMs,
		substituted,
		// The number is a request, not a measurement. Saying so every time is the
		// point: two rigs running 0.35 can differ tenfold at the leaf.
		delivered : null,
		why : `${spec.why}${substituted ? ` Driving ${CHANNELS[ channel ].label} (${CHANNELS[ channel ].nm}nm) because this fixture has no ${CHANNELS[ exact ].label}; the response will be real but weaker than at ${CHANNELS[ exact ].nm}nm.` : ''} Level ${spec.level} is a drive setting, not a dose — what reaches the leaf depends on this fixture, its distance and its beam, and only a PAR sensor can tell you what actually arrived.`,
	}

}

/**
 * What a given fixture can and cannot do.
 *
 * @param   {string} id - Fixture id.
 * @returns {object}    `{probes, blocked, notes}`.
 */
export function fixtureCapability( id ) {

	const f = FIXTURES[ id ]
	if ( !f ) return null

	const probes = [], blocked = []
	let sham = null

	for ( const band of Object.keys( RECIPES ) ) {

		const r = recipe( band, 'probe', id )

		// A sham control is not a probe: it emits nothing. It is only worth
		// anything alongside at least one real one, because a control with
		// nothing to control for controls for nothing.
		if ( r.sham ) {

			sham = {
				band,
				why : r.why,
			}
			continue

		}

		;( r.usable ? probes : blocked ).push( {
			band,
			why : r.why,
		} )

	}

	const total = probes.length + blocked.length

	return {
		id,
		label : f.label,
		channels : f.channels,
		probes,
		blocked,
		control : probes.length
			? ( sham || { band : 'amber' } )
			: null,
		caveats : f.caveats || [],
		notes : f.notes,
		verdict : probes.length
			? `${probes.length} of ${total} probes available on this fixture${sham ? ', with the control running as a sham' : ''}.`
			: `No probing is possible with this fixture. ${f.notes}`,
	}

}

/** Every fixture, for a picker. */
export const FIXTURE_IDS = Object.keys( FIXTURES )

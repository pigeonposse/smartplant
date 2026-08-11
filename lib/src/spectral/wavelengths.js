/**
 * The spectral catalogue: which wavelength reaches which photoreceptor, what it
 * is good for as a *probe*, and what it does — and can break — as a *treatment*.
 *
 * Two things are kept rigorously apart here, because conflating them is how a
 * light system kills a plant:
 *
 *   `probe`   — a brief, low-intensity interrogation. Reads a pathway.
 *   `treat`   — a sustained, physiologically meaningful dose. Changes the plant.
 *
 * Every treatment carries `contraindications`: conditions under which applying
 * it is actively harmful. Those are enforced as hard interlocks in
 * `SpectralSafety`, not left to a model's judgement.
 */

/**
 * @typedef {object} Band
 * @property {string}   id            - Stable identifier.
 * @property {string}   label         - Human name.
 * @property {string}   emoji         - For status lines and docs.
 * @property {number}   nm            - Peak wavelength.
 * @property {number[]} range         - `[min, max]` nm.
 * @property {string[]} photoreceptors- What absorbs it.
 * @property {object}   probe         - How to use it as an interrogation.
 * @property {object}   treat         - How to use it as a treatment.
 */

/** Response latency of each pathway, which sets how slowly you must probe it. */
const LATENCY = {
	// Stomatal aperture is the slowest thing anyone tries to probe with light:
	// blue-induced opening takes minutes, not seconds.
	stomatal      : { openingMinutes : [ 5, 30 ] },
	photosynthetic: { onsetSeconds : [ 30, 300 ] },
	phytochrome   : { conversionMinutes : [ 5, 60 ] },
}

/** @type {Record<string, Band>} */
export const BANDS = {

	uvb : {
		id    : 'uvb',
		label : 'UV-B',
		emoji : '🟣',
		nm    : 300,
		range : [ 280, 315 ],
		photoreceptors : [ 'UVR8' ],
		probe : {
			// Deliberately absent. There is no safe dose small enough to be worth
			// using UV-B as a routine interrogation.
			usable : false,
			why    : 'UV-B is DNA-damaging. It is never used as a routine probe.',
		},
		treat : {
			effect  : 'Triggers UVR8 signalling: flavonoid and anthocyanin synthesis, thicker cuticle, raised pathogen resistance.',
			risk    : 'critical',
			// Hormetic: the benefit and the damage are the same mechanism at
			// different doses.
			maxDailySeconds : 900,
			maxIrradiance   : 0.5,
			contraindications : [
				{
					requires : [ 'happiness' ],
					when : ctx => ctx.happiness < 40,
					why : 'A stressed plant has no spare capacity for a hormetic stressor.' },
				{
					requires : [ 'soil' ],
					when : ctx => ctx.current.soil < 25,
					why : 'UV-B on a water-stressed plant compounds oxidative damage.' },
			],
			requiresHuman : true,
			humanWarning  : 'UV-B is an eye and skin hazard. Confirm nobody is in the room and the fixture is shielded.',
		},
	},

	uva : {
		id    : 'uva',
		label : 'UV-A',
		emoji : '🟪',
		nm    : 380,
		range : [ 315, 400 ],
		photoreceptors : [ 'cryptochrome', 'phototropin' ],
		probe : {
			usable      : true,
			reads       : 'cryptochrome_response',
			periodMinutes : 12,
			why         : 'Shares receptors with blue; useful as a control channel to separate cryptochrome from phototropin effects.',
		},
		treat : {
			effect  : 'Compacts leaf expansion and raises pigment density per unit area.',
			risk    : 'medium',
			maxDailySeconds : 7200,
			contraindications : [
				{
					requires : [ 'happiness' ],
					when : ctx => ctx.happiness < 30,
					why : 'Morphological forcing on a failing plant adds load without benefit.' },
			],
		},
	},

	blue : {
		id    : 'blue',
		label : 'Blue',
		emoji : '🔵',
		nm    : 450,
		range : [ 400, 500 ],
		photoreceptors : [ 'phototropin', 'cryptochrome' ],
		probe : {
			usable        : true,
			reads         : 'stomatal_response',
			// Stomata take 5-30 min to open. A probe faster than that reads nothing.
			periodMinutes : 16,
			pulseSeconds  : 240,
			why           : 'Blue drives the guard-cell H+-ATPase and K+ influx. The size and latency of the resulting depolarization is a direct readout of stomatal competence — and therefore of turgor and hydration.',
			interprets    : {
				strong : 'Stomata open readily: turgor and water status are adequate.',
				weak   : 'Blunted or delayed response: ABA is holding the stomata shut, which means water stress.',
				absent : 'No stomatal response at all: severe water stress, or the electrode has lost contact.',
			},
			latency : LATENCY.stomatal,
		},
		treat : {
			effect  : 'Forces stomatal opening, raising transpiration and gas exchange.',
			risk    : 'high',
			maxDailySeconds : 14_400,
			contraindications : [
				{
					// THE important one. A dry plant closed its stomata via ABA to
					// survive. Forcing them open spends water it does not have.
					requires : [ 'soil' ],
					when : ctx => ctx.current.soil < 30,
					why  : 'The plant closed its stomata to conserve water. Forcing them open with blue light overrides that defence and accelerates dehydration.',
				},
				{
					requires : [ 'humidity' ],
					when : ctx => ctx.current.humidity < 25,
					why  : 'Very dry air already maximizes transpiration; adding stomatal opening risks desiccation.',
				},
				{
					requires : [ 'temperature' ],
					when : ctx => ctx.current.temperature > 32,
					why  : 'Above 32°C the plant is already losing water fast; forcing transpiration compounds heat and drought stress.',
				},
			],
		},
	},

	green : {
		id    : 'green',
		label : 'Green',
		emoji : '🟢',
		nm    : 530,
		range : [ 500, 600 ],
		photoreceptors : [ 'chlorophyll (weak absorption)', 'cryptochrome (antagonistic)' ],
		probe : {
			usable        : true,
			reads         : 'mesophyll_response',
			periodMinutes : 20,
			pulseSeconds  : 300,
			why           : 'Green is poorly absorbed at the surface, so it penetrates to the deep mesophyll and lower canopy. Its response reports on tissue the blue and red probes never reach.',
			interprets    : {
				strong : 'Deep mesophyll is photosynthetically active; the lower canopy is healthy.',
				weak   : 'Deep tissue is under-responding: internal shading, senescing lower leaves, or dense canopy.',
			},
			latency : LATENCY.photosynthetic,
		},
		treat : {
			effect  : 'Illuminates lower and inner canopy that surface-absorbed wavelengths cannot reach.',
			risk    : 'low',
			maxDailySeconds : 28_800,
			contraindications : [],
		},
	},

	amber : {
		id    : 'amber',
		label : 'Amber',
		emoji : '🟠',
		nm    : 590,
		range : [ 570, 620 ],
		photoreceptors : [ 'minimal' ],
		probe : {
			usable        : true,
			reads         : 'baseline',
			periodMinutes : 10,
			why           : 'Weakly photosynthetically active, so it lights the plant for the camera without perturbing the electrical baseline. This is the control channel — the one that tells you what "no stimulus" looks like.',
			isControl     : true,
		},
		treat : {
			effect  : 'Working light for vision capture with minimal photochemical perturbation.',
			risk    : 'low',
			maxDailySeconds : 28_800,
			contraindications : [],
		},
	},

	red : {
		id    : 'red',
		label : 'Red',
		emoji : '🔴',
		nm    : 660,
		range : [ 600, 700 ],
		photoreceptors : [ 'chlorophyll a/b', 'phytochrome (Pr→Pfr)' ],
		probe : {
			usable        : true,
			reads         : 'photosynthetic_response',
			periodMinutes : 8,
			pulseSeconds  : 120,
			why           : 'Red excites Photosystem II directly. The amplitude and onset of the resulting potential shift track electron transport, so it reads photosynthetic capacity independently of water status.',
			interprets    : {
				strong : 'Electron transport is efficient; the photosynthetic apparatus is intact.',
				weak   : 'Reduced capacity despite adequate water: suspect nutrient deficiency (N, Mg, Fe) or photosystem damage.',
			},
			latency : LATENCY.photosynthetic,
		},
		treat : {
			effect  : 'Maximum chlorophyll excitation: drives electron transport, ATP/NADPH synthesis and carbon fixation.',
			risk    : 'medium',
			maxDailySeconds : 43_200,
			contraindications : [
				{
					requires : [ 'soil' ],
					when : ctx => ctx.current.soil < 20,
					why  : 'Driving photosynthesis raises water demand the plant cannot meet.',
				},
				{
					requires : [ 'temperature' ],
					when : ctx => ctx.current.temperature > 35,
					why  : 'Above 35°C photosynthesis is already heat-limited; more light adds photo-oxidative load.',
				},
			],
		},
	},

	farRed : {
		id    : 'farRed',
		label : 'Far-red',
		emoji : '🟥',
		nm    : 730,
		range : [ 700, 800 ],
		photoreceptors : [ 'phytochrome (Pfr→Pr)' ],
		probe : {
			usable        : true,
			reads         : 'phytochrome_state',
			periodMinutes : 30,
			pulseSeconds  : 300,
			why           : 'Reverses phytochrome to its inactive form. Pairing a red pulse with a far-red pulse and measuring the difference isolates the phytochrome contribution from the photosynthetic one.',
			latency       : LATENCY.phytochrome,
		},
		treat : {
			effect  : 'Shifts the phytochrome ratio: induces stem elongation (shade avoidance), signals end of day, can trigger flowering.',
			risk    : 'high',
			maxDailySeconds : 1800,
			contraindications : [
				{
					when : () => true,
					why  : 'Far-red induces shade-avoidance elongation, which weakens an indoor plant. Only apply on an explicit, deliberate request — never as an automatic remedy.',
					overridable : true,
				},
			],
			requiresHuman : true,
		},
	},

	nir : {
		id    : 'nir',
		label : 'Near-infrared',
		emoji : '⬛',
		nm    : 940,
		range : [ 800, 1200 ],
		photoreceptors : [ 'none (thermal)' ],
		probe : {
			usable : false,
			why    : 'NIR has no photoreceptor. Any response is thermal, which confounds rather than informs.',
		},
		treat : {
			effect  : 'Radiant warming of leaf tissue without photosynthetic excitation.',
			risk    : 'high',
			maxDailySeconds : 3600,
			contraindications : [
				{
					requires : [ 'temperature' ],
					when : ctx => ctx.current.temperature > 20,
					why  : 'The plant is not cold. Adding radiant heat raises transpiration for no benefit.',
				},
				{
					requires : [ 'soil' ],
					when : ctx => ctx.current.soil < 30,
					why  : 'Warming a water-stressed plant accelerates water loss.',
				},
			],
			note : 'The claim that NIR "excites water molecules to reactivate sap flow" overstates it: water absorption peaks lie further into the infrared. Treat this as gentle radiant warming, nothing more.',
		},
	},

}

export const BAND_IDS = Object.keys( BANDS )

/** Bands usable as probes, in the order a full sweep should run them. */
export const PROBE_ORDER = [ 'amber', 'blue', 'red', 'green', 'farRed' ]

/**
 * Look up a band by id or by wavelength.
 *
 * @param   {string|number} key - Band id, or a wavelength in nm.
 * @returns {Band|null}         The band.
 */
export function band( key ) {

	if ( typeof key === 'string' ) return BANDS[ key ] || null
	if ( Number.isFinite( key ) ) {

		return Object.values( BANDS ).find( b => key >= b.range[ 0 ] && key < b.range[ 1 ] ) || null

	}
	return null

}

/**
 * Which contraindications currently apply to treating with a band.
 *
 * @param   {string}   bandId - Band id.
 * @param   {object}   ctx    - Plant context.
 * @returns {object[]}        Blocking reasons, empty if clear.
 */
export function contraindications( bandId, ctx ) {

	const b = BANDS[ bandId ]
	if ( !b ) return [ { why : `Unknown band "${bandId}".` } ]

	const out = []

	for ( const c of b.treat.contraindications || [] ) {

		// Missing data blocks. `undefined < 30` is false, so without this an
		// absent soil reading would silently *permit* the very treatment that
		// most needs it — the failure mode is a dead plant and a clean log.
		const missing = ( c.requires || [] ).filter( metric => {

			const v = metric === 'happiness' ? ctx?.happiness : ctx?.current?.[ metric ]
			return !Number.isFinite( v )

		} )

		if ( missing.length ) {

			out.push( {
				band : bandId,
				why  : `Cannot verify ${missing.join( ' and ' )} — refusing to treat without knowing the plant's state. (${c.why})`,
				overridable : false,
				missingData : missing,
			} )
			continue

		}

		let fires
		try {

			fires = c.when( ctx )

		}
		catch {

			// A predicate that throws is treated as blocking, same principle.
			fires = true

		}

		if ( fires ) out.push( {
			band : bandId,
			why : c.why,
			overridable : !!c.overridable,
		} )

	}

	return out

}

/**
 * The catalogue rendered for humans — used by the README, the CLI and the docs.
 *
 * @returns {object[]} One row per band.
 */
export function describeBands() {

	return Object.values( BANDS ).map( b => ( {
		emoji  : b.emoji,
		label  : b.label,
		nm     : b.nm,
		receptors : b.photoreceptors.join( ', ' ),
		probes : b.probe.usable ? b.probe.reads : null,
		effect : b.treat.effect,
		risk   : b.treat.risk,
	} ) )

}

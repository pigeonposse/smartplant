/**
 * Somewhere to start.
 *
 * Until now every plant began life with one generic set of thresholds: a cactus
 * and a fern were told the same soil was too dry, and the first weeks of any
 * deployment were spent measuring against numbers that fitted neither. The plant
 * eventually learns its own ranges, but "eventually" is the problem — the early
 * weeks are when a new plant is most fragile and when the system is least able
 * to help it.
 *
 * These are six broad strategies that between them cover most of what people
 * grow. They are not species profiles and are not meant to be: a species profile
 * is a research problem, while "this is a plant that stores water and opens its
 * stomata at night" is a fact you know the moment you look at it, and it is
 * enough to stop the system being wrong in the obvious ways.
 *
 * ## An archetype is a starting point, not a truth
 *
 * It is the same rule that governs an inherited prior: it applies until the
 * plant's own measurements say otherwise, and then it yields. A Monstera in a
 * dark hallway is not the Monstera in the archetype, and after a month of
 * readings the plant's own record is the better description. Nothing here
 * overrides a measurement.
 *
 * ## The one that is more than a threshold
 *
 * Five of these six differ only in numbers. The CAM archetype differs in
 * *direction*: those plants open their stomata at night and keep them shut
 * through the day, which is the opposite of everything else here.
 *
 * That inverts two readings the library makes. A blue-light probe at midday
 * finds a cactus with closed stomata and reports water stress, when what it has
 * actually found is a cactus behaving correctly. And the circadian analysis
 * expects peak activity in daylight, so a healthy CAM plant looks maximally
 * misaligned. Both are confident, both are wrong, and no amount of data fixes
 * them because the interpretation is upside down rather than imprecise.
 *
 * That single flag is the strongest argument for this file existing.
 */

/** Whether stomata open by day or by night. */
export const RHYTHM = {
	DIURNAL   : 'diurnal',
	NOCTURNAL : 'nocturnal',
}

/**
 * The six.
 *
 * `dli` is in mol/m²/day and is **not** converted from lux anywhere. The factor
 * between them depends on the spectrum of the source — sunlight, a white LED and
 * a grow light differ by more than a factor of two — so a converted figure would
 * carry an error nobody could see. It is recorded as the target a PAR sensor
 * would confirm, and lux ranges are given separately as the rough guide they are.
 */
export const ARCHETYPES = {

	xerophyte : {
		label   : 'Xerophyte & CAM',
		examples: [ 'cactus', 'succulent', 'aloe', 'echeveria', 'euphorbia', 'sansevieria', 'agave', 'crassula', 'kalanchoe', 'haworthia' ],
		rhythm  : RHYTHM.NOCTURNAL,
		summary : 'Stores water in its tissue and opens its stomata at night to take in CO₂ without losing it.',
		ranges  : {
			temperature : {
				min : 15,
				max : 32,
			},
			humidity    : {
				min : 20,
				max : 50,
			},
			// Wide and low: these want to dry out completely between waterings,
			// and a "too dry" alarm at 35% would fire permanently and mean nothing.
			soil        : {
				min : 5,
				max : 25,
			},
			light       : {
				min : 1500,
				max : 20_000,
			},
		},
		vpd     : {
			min : 1.5,
			max : 2.5,
		},
		dli     : {
			min : 15,
			max : 30,
		},
		notes   : 'Drought between waterings is not neglect, it is the regime. Constant moisture is what kills these.',
		subgroups : {
			desert   : {
				label : 'Desert cactus',
				examples : [ 'cactus', 'agave', 'euphorbia' ],
				soil : {
					min : 3,
					max : 15,
				},
			},
			forest   : {
				label : 'Forest cactus (Schlumbergera, Rhipsalis)',
				examples : [ 'schlumbergera', 'rhipsalis', 'epiphyllum', 'christmas cactus' ],
				soil : {
					min : 20,
					max : 40,
				},
				light : {
					min : 800,
					max : 5000,
				},
				notes : 'Epiphytic rather than desert: these want more water and less sun than the archetype suggests.',
			},
			caudex   : {
				label : 'Caudiciform',
				examples : [ 'adenium', 'pachypodium', 'dioscorea' ],
				soil : {
					min : 3,
					max : 18,
				},
				notes : 'Strongly seasonal — a dormant caudex wants almost nothing at all.',
			},
		},
	},

	tropical : {
		label   : 'Tropical understorey & epiphyte',
		examples: [ 'monstera', 'pothos', 'philodendron', 'anthurium', 'orchid', 'epipremnum', 'scindapsus', 'syngonium', 'aglaonema', 'dieffenbachia' ],
		rhythm  : RHYTHM.DIURNAL,
		summary : 'Warm, humid and filtered light. Roots suffocate easily in a substrate that holds water.',
		ranges  : {
			temperature : {
				min : 18,
				max : 29,
			},
			humidity    : {
				min : 55,
				max : 80,
			},
			soil        : {
				min : 25,
				max : 50,
			},
			light       : {
				min : 400,
				max : 3000,
			},
		},
		vpd     : {
			min : 0.7,
			max : 1.2,
		},
		dli     : {
			min : 3,
			max : 10,
		},
		notes   : 'The usual failure is not underwatering, it is a dense substrate with no air in it. Sensitive to salt building up around the roots.',
		subgroups : {
			aroid    : {
				label : 'Climbing aroid',
				examples : [ 'monstera', 'philodendron', 'epipremnum', 'scindapsus' ],
				soil : {
					min : 25,
					max : 45,
				},
			},
			epiphyte : {
				label : 'Epiphytic orchid',
				examples : [ 'orchid', 'phalaenopsis', 'cattleya', 'dendrobium' ],
				soil : {
					min : 15,
					max : 35,
				},
				humidity : {
					min : 60,
					max : 85,
				},
				notes : 'Roots are aerial and photosynthetic. Bark, not soil — a moisture percentage from a probe in bark is a rough guide at best.',
			},
		},
	},

	hygrophyte : {
		label   : 'Hygrophyte & deep shade',
		examples: [ 'fern', 'calathea', 'maranta', 'moss', 'asplenium', 'adiantum', 'nephrolepis', 'fittonia', 'selaginella' ],
		rhythm  : RHYTHM.DIURNAL,
		summary : 'Thin leaves and a thin cuticle, so they lose water almost as fast as the air will take it.',
		ranges  : {
			temperature : {
				min : 17,
				max : 26,
			},
			humidity    : {
				min : 65,
				max : 90,
			},
			soil        : {
				min : 45,
				max : 70,
			},
			light       : {
				min : 150,
				max : 1200,
			},
		},
		vpd     : {
			min : 0.3,
			max : 0.7,
		},
		dli     : {
			min : 1,
			max : 4,
		},
		notes   : 'Direct sun destroys chlorophyll here in hours. These are the plants where VPD matters more than soil moisture: dry air alone will crisp them with a wet pot.',
		subgroups : {
			fern : {
				label : 'Fern',
				examples : [ 'fern', 'asplenium', 'adiantum', 'nephrolepis' ],
				soil : {
					min : 50,
					max : 75,
				},
			},
			prayer : {
				label : 'Calathea / Maranta',
				examples : [ 'calathea', 'maranta', 'ctenanthe', 'goeppertia' ],
				humidity : {
					min : 70,
					max : 90,
				},
				notes : 'Notoriously intolerant of hard tap water as well as dry air.',
			},
		},
	},

	heliophyte : {
		label   : 'Heliophyte C3 & outdoor',
		examples: [ 'rose', 'tomato', 'daisy', 'basil', 'pepper', 'lettuce', 'strawberry', 'sunflower', 'lavender', 'geranium' ],
		rhythm  : RHYTHM.DIURNAL,
		summary : 'High energy demand: fast growth or flowering, and a matching appetite for light, water and nutrients.',
		ranges  : {
			temperature : {
				min : 15,
				max : 30,
			},
			humidity    : {
				min : 40,
				max : 70,
			},
			soil        : {
				min : 35,
				max : 60,
			},
			light       : {
				min : 3000,
				max : 50_000,
			},
		},
		vpd     : {
			min : 0.9,
			max : 1.5,
		},
		dli     : {
			min : 15,
			max : 35,
		},
		notes   : 'Tolerates a wide day-night temperature swing, which indoor plants often do not. Drainage matters as much as watering.',
		subgroups : {
			fruiting : {
				label : 'Fruiting vegetable',
				examples : [ 'tomato', 'pepper', 'strawberry', 'cucumber', 'aubergine' ],
				soil : {
					min : 40,
					max : 65,
				},
				notes : 'Water stress during fruiting shows up in the fruit, not the leaves.',
			},
			herb     : {
				label : 'Mediterranean herb',
				examples : [ 'rosemary', 'thyme', 'lavender', 'oregano', 'sage' ],
				soil : {
					min : 20,
					max : 45,
				},
				humidity : {
					min : 30,
					max : 60,
				},
				notes : 'Rosemary, thyme, lavender: these want it drier than the archetype and die of kindness.',
			},
		},
	},

	c4 : {
		label   : 'C4 & high efficiency',
		examples: [ 'maize', 'corn', 'sugarcane', 'sorghum', 'miscanthus', 'pennisetum', 'bamboo', 'grass' ],
		rhythm  : RHYTHM.DIURNAL,
		summary : 'A carbon-concentrating mechanism that keeps photosynthesis running at light and heat levels where C3 plants stall.',
		ranges  : {
			temperature : {
				min : 18,
				max : 35,
			},
			humidity    : {
				min : 35,
				max : 70,
			},
			soil        : {
				min : 20,
				max : 45,
			},
			light       : {
				min : 5000,
				max : 80_000,
			},
		},
		vpd     : {
			min : 1.2,
			max : 2,
		},
		dli     : {
			min : 25,
			max : 45,
		},
		notes   : 'Uses water remarkably efficiently and keeps its stomata open at a VPD that would shut a C3 plant down. Do not read that openness as comfort — it is a different machine.',
	},

	woody : {
		label   : 'Woody perennial',
		examples: [ 'ficus', 'citrus', 'olive', 'bonsai', 'jade', 'schefflera', 'camellia', 'azalea', 'laurel' ],
		rhythm  : RHYTHM.DIURNAL,
		summary : 'Slow to respond and slow to fail, with deep roots and stored reserves to buffer both.',
		ranges  : {
			temperature : {
				min : 15,
				max : 28,
			},
			humidity    : {
				min : 40,
				max : 70,
			},
			soil        : {
				min : 25,
				max : 55,
			},
			light       : {
				min : 800,
				max : 15_000,
			},
		},
		vpd     : {
			min : 0.8,
			max : 1.4,
		},
		dli     : {
			min : 6,
			max : 20,
		},
		notes   : 'Resilient to a bad week and intolerant of being moved. Its electrical signals are slower and smaller than a herbaceous plant\'s, so give the electrome baseline longer to settle before trusting it.',
		signals : {
			// Woody tissue conducts differently: the same event is smaller and
			// slower here, and a threshold tuned on a herb will simply miss it.
			settleMultiplier : 2,
			amplitudeScale   : 0.6,
		},
		subgroups : {
			citrus : {
				label : 'Citrus',
				examples : [ 'citrus', 'lemon', 'orange', 'lime', 'mandarin' ],
				soil : {
					min : 30,
					max : 55,
				},
				notes : 'Wants acid feed and hates wet feet.',
			},
			bonsai : {
				label : 'Bonsai',
				examples : [ 'bonsai' ],
				soil : {
					min : 30,
					max : 60,
				},
				notes : 'A small volume of substrate dries fast: the archetype is right about the plant and wrong about the pot.',
			},
		},
	},

}

export const ARCHETYPE_IDS = Object.keys( ARCHETYPES )

/**
 * Guess an archetype from a species name.
 *
 * Deliberately conservative. A wrong archetype is worse than none, because it
 * replaces a set of thresholds nobody trusts with a set that looks authoritative
 * and is not — so anything that does not match plainly comes back unknown.
 *
 * @param   {string} species - Species or common name.
 * @returns {object|null}    `{id, subgroup, matched}` or null.
 */
export function guessArchetype( species ) {

	if ( !species || typeof species !== 'string' ) return null

	const name = species.toLowerCase().trim()

	for ( const [ id, a ] of Object.entries( ARCHETYPES ) ) {

		for ( const [ sub, s ] of Object.entries( a.subgroups || {} ) ) {

			for ( const ex of s.examples || [] ) {

				if ( name.includes( ex ) ) return {
					id,
					subgroup : sub,
					matched : ex,
				}

			}

		}

		for ( const ex of a.examples ) {

			if ( name.includes( ex ) ) return {
				id,
				subgroup : null,
				matched : ex,
			}

		}

	}

	return null

}

/**
 * The full profile for an archetype, with a subgroup folded in.
 *
 * @param   {string} id         - Archetype id.
 * @param   {string} [subgroup] - Subgroup id.
 * @returns {object|null}       The resolved profile.
 */
export function archetype( id, subgroup ) {

	const base = ARCHETYPES[ id ]
	if ( !base ) return null

	const sub = subgroup ? base.subgroups?.[ subgroup ] : null

	// Subgroups override only the metrics they mention, so a subgroup that
	// differs on soil alone inherits everything else rather than restating it.
	const ranges = { ...base.ranges }

	for ( const metric of Object.keys( base.ranges ) ) {

		if ( sub?.[ metric ] ) ranges[ metric ] = sub[ metric ]

	}

	return {
		id,
		subgroup : subgroup || null,
		label    : sub ? `${base.label} · ${sub.label}` : base.label,
		rhythm   : base.rhythm,
		summary  : base.summary,
		ranges,
		vpd      : sub?.vpd || base.vpd,
		dli      : sub?.dli || base.dli,
		signals  : base.signals || null,
		notes    : [ base.notes, sub?.notes ].filter( Boolean ).join( ' ' ),
		// The one field that changes interpretation rather than thresholds.
		nocturnal : base.rhythm === RHYTHM.NOCTURNAL,
	}

}

/**
 * Apply an archetype to a plant, without overwriting what it has measured.
 *
 * @param   {object} plant      - A `SmartPlant`.
 * @param   {object} [opts]     - `{ id, subgroup, force }`.
 * @returns {object}            `{applied, archetype, why}`.
 */
export function applyArchetype( plant, opts = {} ) {

	const guess = opts.id ? null : guessArchetype( plant?.memory?.plant?.species )
	const id = opts.id || guess?.id
	const subgroup = opts.subgroup ?? guess?.subgroup

	if ( !id ) {

		return {
			applied : false,
			why : `No archetype matches "${plant?.memory?.plant?.species || 'this plant'}". A wrong archetype is worse than none — it swaps thresholds nobody trusts for thresholds that look authoritative and are not. Pass one explicitly with { archetype: '${ARCHETYPE_IDS.join( "' | '" )}' }.`,
		}

	}

	const profile = archetype( id, subgroup )

	if ( !profile ) {

		throw new Error( `Unknown archetype "${id}". One of: ${ARCHETYPE_IDS.join( ', ' )}.` )

	}

	// A plant that has learned its own ranges knows better than any archetype.
	const readings = plant.memory?.data?.readings?.length ?? 0

	if ( readings >= ( opts.minReadings ?? 200 ) && !opts.force ) {

		return {
			applied : false,
			archetype : profile,
			why : `"${profile.label}" fits, but this plant already has ${readings} readings of its own. Its own record describes it better than any archetype — pass { force: true } to overwrite that deliberately.`,
		}

	}

	// A learned profile — from the species lookup or from federated learning —
	// is also better evidence than a category. The archetype fills the gaps it
	// leaves rather than replacing it.
	const learned = plant.memory?.profile?.ranges || {}
	const ranges = { ...plant.ranges }
	const filled = [], kept = []

	for ( const [ metric, range ] of Object.entries( profile.ranges ) ) {

		if ( learned[ metric ] && !opts.force ) {

			kept.push( metric )
			continue

		}

		ranges[ metric ] = range
		filled.push( metric )

	}

	plant.ranges = ranges
	plant.archetype = profile

	return {
		applied : filled.length > 0,
		archetype : profile,
		guessed : Boolean( guess ),
		filled,
		kept,
		why : `Starting from "${profile.label}"${guess ? ` (matched on "${guess.matched}")` : ''}. ${profile.summary}${kept.length ? ` Kept the learned ranges for ${kept.join( ', ' )} — measured beats categorised.` : ''} These are a starting point and yield to what this plant actually measures.`,
	}

}

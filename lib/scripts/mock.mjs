/**
 * Every system, end to end, on mock hardware.
 *
 * Not a unit test suite — `node --run test` is that. This walks the whole
 * library the way somebody would actually use it: grow a plant with months of
 * history, let the layers reason about it, and assert on what they conclude
 * rather than on what each function returns.
 *
 * It exists because the two find different things. The unit tests catch a
 * function that stopped working; this catches a function that works and is
 * never reached, or two layers that each behave and disagree with each other.
 *
 * Run with:  node --run mock
 */
import { createPlant } from '../src/index.js'
import { LoopbackBus } from '../src/colony/index.js'

const HOUR = 3600_000, DAY = 86_400_000
let pass = 0, fail = 0
const check = ( label, ok, detail = '' ) => {
	console.log( `  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}` )
	ok ? pass++ : fail++
}
const head = t => console.log( `\n\x1b[1m${t}\x1b[0m` )

let s = 7
const r = () => { s = ( s * 1103515245 + 12345 ) & 0x7fffffff; return s / 0x7fffffff - 0.5 }

async function grow( name, { days = 60, electrode = false, recent = {} } = {} ) {
	const plant = await createPlant( {
		name, species : 'Ficus lyrata',
		sensor : { driver : 'mock', dayNight : false },
		ai : { provider : 'mock' },
	} )
	if ( electrode ) await plant.attachSensor( {
		driver : 'electrode', transport : 'synthetic',
		sampleRate : 5, bufferSeconds : 7200, mainsHz : 0,
		sites : [ { id : 'stem', distanceMm : 50 } ],
	} )
	for ( let i = 0; i < days * 4; i++ ) {
		const at = Date.now() - ( days * 4 - i ) * 6 * HOUR
		const isRecent = at >= Date.now() - 7 * DAY
		await plant.memory.addReading( {
			timestamp : at,
			temperature : ( isRecent ? recent.temperature ?? 22 : 22 ) + r() * 2,
			humidity : 55 + r() * 4,
			soil : ( isRecent ? recent.soil ?? 45 : 45 ) + r() * 5,
			light : 900 + r() * 80,
		} )
	}
	return plant
}

head( '1 · Core: sensing, memory, voice, events' )
const p = await grow( 'Rosa', { electrode : true } )
const reading = await p.read()
check( 'read()', Number.isFinite( reading.temperature ) )
check( 'happiness()', p.happiness() >= 0 && p.happiness() <= 100, `${p.happiness()}%` )
check( 'context() + VPD', Number.isFinite( p.context().vpd ), `${p.context().vpd} kPa (${p.context().vpdBand})` )
check( 'speak()', ( await p.speak( 'how are you?' ) ).length > 0 )
check( 'status()', ( await p.status() ).length > 0 )
let heard = 0; p.on( 'sensor:reading', () => heard++ ); await p.read()
check( 'events fire', heard === 1 )

head( '2 · Electrophysiology + the plant on its own terms' )
const e = p.getSensor( 'electrode' )
e.advance( 300 ); e.stimulate( 'variation_potential' ); e.advance( 400 )
const listened = await p.listen( { seconds : 700 } )
check( 'listen() detecta el evento', listened.events.length > 0, `${listened.events.length} evento(s): ${listened.events.map( x => x.type?.label ).join( ', ' )}` )
check( 'electrome fingerprint', Number.isFinite( listened.fingerprint.complexity ) )
check( 'baseline verdict', typeof listened.shift.verdict === 'string' )
check( 'two-site coherence', Boolean( listened.coherence?.stem ), listened.coherence?.stem?.coherent ? 'coherente' : 'sin corroborar' )

head( '3 · Spectral' )
await p.useSpectral( { light : { driver : 'mock' }, safety : { darkHours : [ 25, 26 ] } } )
const probe = await p.interrogate( { bands : [ 'blue' ], simulate : true } )
check( 'interrogate()', Boolean( probe.responses?.blue ) )
check( 'p-value exacto', Number.isFinite( probe.responses.blue.locking?.pValue ) )
check( 'corrección por nº de bandas', probe.responses.blue.locking?.tests >= 1 )

head( '4 · Prediction error' )
const body = await p.embody( { personalization : { actions : [ 'move_to_light' ] } } )
for ( let i = 0; i < 12; i++ ) {
	await body.personalization.suggest( { happiness : 55 }, { explore : false } )
	await body.personalization.outcome( { happiness : 80 } )
}
body.personalization.predictions.reset( 'move_to_light' )
for ( let i = 0; i < 12; i++ ) {
	await body.personalization.suggest( { happiness : 55 }, { explore : false } )
	await body.personalization.outcome( { happiness : 30 } )
}
const cal = body.personalization.predictions.calibration( 'move_to_light' )
check( 'detecta modelo optimista', cal.bias === 'optimistic', `error medio ${cal.meanError}` )

head( '5 · Continuity + drift attribution' )
const { ContinuityTracker, electromeFingerprint, regimeChange, collectiveState, infectionWatch } = await import( '../src/signals/index.js' )
const wave = ( n, seed ) => { let x = seed; const q = () => { x = ( x * 1103515245 + 12345 ) & 0x7fffffff; return x / 0x7fffffff - 0.5 }
	return Array.from( { length : 600 }, ( _, i ) => -60 + 2 * Math.sin( 2 * Math.PI * i / 300 ) + q() * n ) }
const fpOf = ( n, seed ) => electromeFingerprint( wave( n, seed ), 5, { mainsHz : 0 } )
const track = ( sites, deg ) => { const t = new ContinuityTracker( { anchorAfter : 6, recent : 3 } )
	for ( let i = 0; i < 20; i++ ) for ( const site of sites ) t.push( fpOf( deg( site, i ), i + site.length * 100 ), { site, at : Date.now() - ( 20 - i ) * 3 * DAY } )
	return t }
check( 'un electrodo → inatribuible', track( [ 'a' ], ( _s, i ) => i < 10 ? 0.5 : 9 ).attribute().cause === 'unattributable' )
check( 'uno de dos → electrodo', track( [ 'a', 'b' ], ( x, i ) => x === 'b' && i >= 10 ? 9 : 0.5 ).attribute().cause === 'electrode' )
check( 'los dos → fisiología', track( [ 'a', 'b' ], ( _s, i ) => i < 10 ? 0.5 : 9 ).attribute().cause === 'physiology' )

head( '6 · Regime, collective, infection' )
const hist = Array.from( { length : 16 }, ( _, i ) => ( { at : new Date( Date.now() - ( 16 - i ) * DAY ).toISOString(), fingerprint : fpOf( i < 8 ? 0.5 : 9, i + 1 ) } ) )
check( 'cambio de régimen', regimeChange( hist ).changed )
check( 'sin régimen falso', !regimeChange( hist.map( ( h, i ) => ( { ...h, fingerprint : fpOf( 0.5, i + 1 ) } ) ) ).changed )
check( 'estado colectivo', collectiveState( [ 'a', 'b', 'c' ].map( ( id, i ) => ( { id, fingerprint : fpOf( 0.5, i + 1 ) } ) ) ).coherence > 0.8 )
check( 'infección: 1 canal no basta', !infectionWatch( { regime : { changed : true } } ).corroborated )
check( 'infección: 2 canales sí', infectionWatch( { regime : { changed : true }, vision : { chlorosis : true } } ).corroborated )
check( 'infección: electrodo malo → rechaza', !infectionWatch( { drift : { cause : 'electrode', drifting : true }, vision : { chlorosis : true } } ).suspected )

head( '7 · Intervention signatures' )
for ( let i = 0; i < 4; i++ ) {
	e.advance( 600 ); await p.memory.addEvent( 'water', {} )
	p.memory.data.events.at( -1 ).t = new Date( e.now() ).toISOString(); e.advance( 900 )
}
const learned = await p.learnInterventions( { types : [ 'water' ], windowMinutes : 10 } )
check( 'aprende del registro de cuidados', learned.recorded === 4, learned.why )

head( '8 · Migration + herencia' )
const heir = await grow( 'Nueva', { days : 2 } )
const bundle = await p.exportInheritance()
check( 'export selectivo', ( await p.exportInheritance( { only : [ 'ranges' ] } ) ).modules.join() === 'ranges' )
const graft = await heir.inherit( bundle )
check( 'inherit()', Boolean( heir.inheritance ) )
check( 'compatibilidad evaluada', typeof graft.compatibility.verdict === 'string' )
const { Inheritance } = await import( '../src/migration/index.js' )
// Un bundle con una política real, o la comprobación no comprueba nada.
const withPolicy = { manifest : { schemaVersion : 1, species : 'ficus lyrata', sourceHash : 'x' },
	policies : [ { action : 'move_to_light', trials : 40, meanReward : 0.8, transferability : 0.6, band : 'strong', distinct : 4 } ], withheld : [] }
const comp = { compatibility : { mean : 1, mismatches : [] } }
const old = new Inheritance( withPolicy, { ...comp, graftedAt : Date.now() - 120 * DAY } )
const fresh = new Inheritance( withPolicy, comp )
check( 'decaimiento temporal', old.prior( 'move_to_light' ).weight < fresh.prior( 'move_to_light' ).weight / 2,
	`${fresh.prior( 'move_to_light' ).weight} → ${old.prior( 'move_to_light' ).weight} tras 120d` )
// La herencia dice 0.8; esta planta mide 0. Debe converger monótonamente hacia
// lo medido: 10 pseudo-ensayos contra n reales es exactamente la aritmética.
const diluted = new Inheritance( withPolicy, comp )
const curve = []
for ( const n of [ 0, 10, 30, 60, 120 ] ) {
	while ( ( diluted.local.get( 'move_to_light' )?.n ?? 0 ) < n ) diluted.recordLocal( 'move_to_light', 0 )
	curve.push( diluted.blend( 'move_to_light', 0 ).expected )
}
check( 'la evidencia local gana', curve.every( ( v, i ) => i === 0 || v < curve[ i - 1 ] ) && curve.at( -1 ) < 0.05,
	curve.map( v => v.toFixed( 3 ) ).join( ' → ' ) )

head( '9 · Colony + knowledge transfer' )
const bus = new LoopbackBus()
await p.joinColony( { transport : bus.endpoint( 'rosa' ) } )
await heir.joinColony( { transport : bus.endpoint( 'nueva' ) } )
check( 'peers()', ( await p.colony.peers() ).includes( 'nueva' ) )
const vpd = await p.colony.ask( 'nueva', 'sense.vpd-perception' )
check( 'skill contestada', vpd.ok, `VPD ${vpd.data?.vpd}` )
const denied = await heir.colony.ask( 'rosa', 'rhizo.mycelium-connect' )
check( 'skill sin sensor → rechazo con motivo', !denied.ok && denied.reason.length > 0 )
check( 'canal cerrado a humanos', p.colony.say === undefined )
const chat = await p.colony.report( { to : 'nueva' } )
check( 'conversación', chat.ok && chat.text.length > 0 )
const nc = await p.colony.newcomers()
check( 'detecta novata', nc.some( n => n.peer === 'nueva' ) )
const lesson = await heir.colony.learnFromColony()
check( 'knowledge transfer', lesson.learned, `${lesson.teachers} maestra(s)` )

head( '10 · Self-check + maintenance' )
const cu = await p.checkup()
check( 'checkup semanal', cu.known, cu.verdict.slice( 0, 60 ) )
check( 'narración determinista', typeof cu.narration === 'string' )
const mt = await p.maintenance()
check( 'maintenance()', typeof mt.condition === 'string', `${mt.condition}: ${mt.verdict.slice( 0, 50 )}` )
const stuckPlant = await createPlant( { name : 'Atascada', species : 'F', sensor : { driver : 'mock' }, ai : { provider : 'mock' } } )
for ( let i = 0; i < 30; i++ ) await stuckPlant.memory.addReading( { timestamp : Date.now() - ( 30 - i ) * HOUR, temperature : 22 + i * 0.1, humidity : 55, soil : 40 + i * 0.1, light : 900 } )
const stuckReport = await stuckPlant.maintenance()
check( 'detecta sensor atascado', stuckReport.condition === 'degraded' )
const due = await heir.runDueReviews()
check( 'revisiones automáticas', Object.keys( due ).length > 0, Object.keys( due ).join( ', ' ) )

head( '11 · Plugins' )
const wateringPlugin = ( await import( '../../plugins/watering/index.js' ) ).default
const colonyPlugin = ( await import( '../../plugins/colony/index.js' ) ).default
const migrationPlugin = ( await import( '../../plugins/migration/index.js' ) ).default
const solo = await grow( 'Plugins', { days : 40 } )
await solo.use( wateringPlugin )
check( 'plugin watering', typeof solo.plugin( 'watering' ).predictWatering === 'function' )
await solo.use( migrationPlugin )
check( 'plugin migration', ( await solo.plugin( 'migration' ).bequeath() ).summary.length > 0 )
const bus2 = new LoopbackBus()
const c1 = await grow( 'C1', { days : 40 } ), c2 = await grow( 'C2', { days : 40 } )
await c1.use( colonyPlugin, { transport : bus2.endpoint( 'c1' ) } )
await c2.use( colonyPlugin, { transport : bus2.endpoint( 'c2' ) } )
check( 'plugin colony', ( await c1.plugin( 'colony' ).peers() ).includes( 'c2' ) )
check( 'instancia por planta', c1.plugin( 'colony' ) !== c2.plugin( 'colony' ) )

head( '12 · Monitorización viva' )
const live = await grow( 'Viva', { days : 40 } )
let ticks = 0; live.on( 'sensor:reading', () => ticks++ )
await live.startMonitoring( { interval : 60 } )
await new Promise( r2 => setTimeout( r2, 220 ) )
await live.stopMonitoring()
check( 'bucle de monitorización', ticks >= 3, `${ticks} lecturas` )


head( '13 · Qué funcionó la última vez' )
const { ResolutionLedger, doseModifier } = await import( '../src/resolutions/index.js' )
const H2 = 3600_000
const epi = ( led, prob, { action, resolved, hours } ) => {
	const t = Date.now() - hours * H2 * 2
	led.opened( prob, { at : t } ); if ( action ) led.acted( action )
	led.closed( prob, { resolved, at : t + hours * H2 } )
}
const superstition = new ResolutionLedger()
for ( let i = 0; i < 5; i++ ) epi( superstition, 'thirsty', { resolved : true, hours : 20 } )
for ( let i = 0; i < 5; i++ ) epi( superstition, 'thirsty', { action : 'water', resolved : true, hours : 19 } )
check( 'rechaza crédito cuando se curaba sola', superstition.recommend( 'thirsty' ).recommend === false )

const real = new ResolutionLedger()
for ( let i = 0; i < 5; i++ ) epi( real, 'thirsty', { resolved : i < 1, hours : 60 } )
for ( let i = 0; i < 5; i++ ) epi( real, 'thirsty', { action : 'water', resolved : true, hours : 8 } )
const rec = real.recommend( 'thirsty' )
check( 'recomienda cuando bate a esperar', rec.recommend && rec.action === 'water', `lift ${rec.lift}` )

const muddle = new ResolutionLedger()
for ( let i = 0; i < 5; i++ ) epi( muddle, 'thirsty', { resolved : false, hours : 60 } )
for ( let i = 0; i < 5; i++ ) { const t = Date.now(); muddle.opened( 'thirsty', { at : t } )
	muddle.acted( 'water' ); muddle.acted( 'fertilize' ); muddle.closed( 'thirsty', { resolved : true, at : t + 8 * H2 } ) }
check( 'no atribuye con varias acciones a la vez', muddle.whatWorked( 'thirsty' ).actions.length === 0 )

check( 'histéresis reactiva → baja dosis', doseModifier( { known : true, changed : true, direction : 'stronger and faster' } ).direction === 'reduce' )
check( 'histéresis débil → NO sube dosis', doseModifier( { known : true, changed : true, direction : 'weaker' } ).direction === 'hold' )

const sed = await grow( 'Sed', { days : 5 } )
check( 'ledger vive en el kernel', typeof sed.resolutions?.recommend === 'function' )
check( 'whatWorkedBefore() responde', ( await sed.whatWorkedBefore( 'plant:thirsty' ) ).recommend === false )
await sed.destroy()


// Mismo problema, condiciones distintas → respuestas opuestas
const HOT = { temperature : 31, humidity : 25, soil : 20 }
const COOL = { temperature : 17, humidity : 70, soil : 20 }
const weather = new ResolutionLedger()
const addW = ( ctx, o ) => { const t = Date.now() - ( o.hours ?? 12 ) * H2 * 2
	weather.opened( 'thirsty', { at : t, context : ctx } )
	for ( const a of o.actions || [] ) weather.acted( a )
	weather.closed( 'thirsty', { resolved : o.resolved, at : t + ( o.hours ?? 12 ) * H2 } ) }
for ( let i = 0; i < 4; i++ ) addW( HOT, { resolved : false, hours : 60 } )
for ( let i = 0; i < 4; i++ ) addW( HOT, { actions : [ 'water' ], resolved : true, hours : 6 } )
for ( let i = 0; i < 4; i++ ) addW( COOL, { resolved : true, hours : 12 } )
for ( let i = 0; i < 4; i++ ) addW( COOL, { actions : [ 'water' ], resolved : true, hours : 12 } )
check( 'con calor sí recomienda', weather.recommend( 'thirsty', { like : HOT } ).recommend === true )
check( 'con fresco NO recomienda', weather.recommend( 'thirsty', { like : COOL } ).recommend === false )

// La colonia: misma especie, con base rate, contada una vez
const rbus = new LoopbackBus()
const mkR = async ( n, sp ) => { const q = await createPlant( { name : n, species : sp,
	sensor : { driver : 'mock', dayNight : false }, ai : { provider : 'mock' } } )
	await q.read(); await q.joinColony( { transport : rbus.endpoint( n.toLowerCase() ) } ); return q }
const epR = ( q, pr, o ) => { const t = Date.now() - o.hours * H2 * 2
	q.resolutions.opened( pr, { at : t } ); if ( o.action ) q.resolutions.acted( o.action )
	q.resolutions.closed( pr, { resolved : o.resolved, at : t + o.hours * H2 } ) }
const elder = await mkR( 'Elder', 'Ficus lyrata' )
for ( let i = 0; i < 5; i++ ) epR( elder, 'plant:thirsty', { resolved : i < 1, hours : 60 } )
for ( let i = 0; i < 6; i++ ) epR( elder, 'plant:thirsty', { action : 'water', resolved : true, hours : 7 } )
const wrong = await mkR( 'Wrong', 'Monstera deliciosa' )
for ( let i = 0; i < 5; i++ ) epR( wrong, 'plant:thirsty', { resolved : false, hours : 60 } )
for ( let i = 0; i < 6; i++ ) epR( wrong, 'plant:thirsty', { action : 'move', resolved : true, hours : 4 } )
const rookie = await mkR( 'Rookie', 'Ficus lyrata' )
const shared = await rookie.colony.askColonyWhatWorked( 'plant:thirsty' )
check( 'la colonia aporta cuando uno no sabe', shared.recommend === true && shared.action === 'water' )
check( 'ignora otra especie', shared.from === 1 )
check( 'confianza de vecina < propia', shared.confidence <= 0.45 )
const viaKernel = await rookie.whatWorkedBefore( 'plant:thirsty' )
check( 'whatWorkedBefore recurre a la colonia', viaKernel.fromColony === true )
await Promise.all( [ elder, wrong, rookie ].map( q => q.destroy() ) )

head( '14 · System diagnosis' )
const diag = await grow( 'Diag', { days : 5 } )
const dr = await diag.systemDiagnosis( { probeAI : false } )
check( 'diagnóstico corre', Array.isArray( dr.checks ) && dr.checks.length >= 9, `${dr.checks.length} comprobaciones` )
check( 'incluye aprendizaje', dr.checks.some( c => c.area === 'learning' ) )
check( 'toda línea roja/ámbar trae instrucción', dr.checks.every( c => c.result === 'ok' || c.result === 'absent' || c.fix ) )
await diag.destroy()

const broken = await createPlant( { name : 'Rota', species : 'F',
	sensor : { driver : 'manual', initial : { humidity : 140, temperature : 22, soil : 50, light : 900 } }, ai : { provider : 'mock' } } )
const br = await broken.systemDiagnosis( { probeAI : false } )
check( 'detecta lectura imposible', br.counts.fail >= 1 && !br.ok )
check( 'da instrucciones concretas', br.fixes.length > 0, `${br.fixes.length} instrucción(es)` )
await broken.destroy()


head( '15 · Medidores cableados' )
const wired = await grow( 'Cableada', { days : 5, electrode : true } )
wired.getSensor( 'electrode' ).advance( 400 )
await wired.embody( { personalization : { actions : [ 'a' ] } } )
await wired.listen( { seconds : 300 } )
check( 'continuidad se construye sola', wired.continuity?.sites.size > 0 )
check( 'régimen se evalúa en listen()', wired._lastRegime !== undefined || wired.continuity.sites.get( 'primary' ).history.length < 10 )
check( 'vigilancia de infección corre', wired._lastInfectionWatch !== undefined )
const mReport = await wired.maintenance()
check( 'mantenimiento entra al ledger', typeof mReport.condition === 'string' )
check( 'goodMoment() responde', typeof ( await wired.goodMoment( 'probe' ) ).good === 'boolean' )
await wired.destroy()

head( '16 · Inferencias cruzadas' )
const { leafVpd, uptakeBalance, thermalInertia, rootEffort } = await import( '../src/inference/index.js' )
check( 'no inventa temperatura de hoja', leafVpd( { temperature : 28, humidity : 40 } ).known === false )
check( 'hoja fría = transpirando', leafVpd( { temperature : 28, humidity : 40, leafTemperature : 25 } ).state === 'transpiring' )
check( 'hoja caliente = estomas cerrados', leafVpd( { temperature : 28, humidity : 40, leafTemperature : 31 } ).state === 'closed' )
const salty = Array.from( { length : 10 }, ( _, i ) => ( { t : new Date( Date.now() - ( 10 - i ) * 3600_000 ).toISOString(), soil : 60 - i * 3, conductivity : 800 + i * 40 } ) )
check( 'detecta salinización', uptakeBalance( salty ).state === 'salt_accumulating' )
const dryPot = Array.from( { length : 14 }, ( _, i ) => ( { t : new Date( Date.now() - ( 14 - i ) * 3600_000 ).toISOString(), temperature : 20 + 8 * Math.sin( i / 2 ), soilTemperature : 20 + 7 * Math.sin( i / 2 ) } ) )
check( 'inercia térmica delata sustrato seco', thermalInertia( dryPot ).state === 'dry' )
check( 'tensiómetro en kPa', rootEffort( { matricPotential : -75 } ).state === 'straining' )

head( '17 · Registro tabular' )
const tab = await grow( 'Tabla', { days : 1 } )
await tab.water()
const table = await tab.journal( { hours : 24, everyMinutes : 60 } )
check( 'una fila por intervalo', table.rows.length > 0, `${table.rows.length} filas` )
check( 'columnas con unidades', table.columns.some( c => c.unit === '°C' ) )
check( 'derivadas incluidas', table.columns.some( c => c.key === 'vpd' ) )
check( 'informa la cobertura', Number.isFinite( table.coverage.ratio ) )
const { toCSV } = await import( '../src/journal/index.js' )
check( 'exporta CSV', toCSV( table ).split( '\n' ).length > 1 )
await tab.destroy()

head( '18 · Catálogo de dispositivos' )
const { devices : cat, suggest : sug, SUPPORT : SUP } = await import( '../src/devices/index.js' )
check( 'catálogo poblado', cat().length >= 25, `${cat().length} dispositivos` )
check( 'todos declaran su nivel de soporte', cat().every( x => Object.values( SUP ).includes( x.support ) ) )
check( 'todos llevan nota de cableado', cat().every( x => x.notes ) )
check( 'sugiere qué comprar', sug( [ 'temperature', 'humidity' ] ).length > 0 )
check( 'no sugiere lo no soportado', sug( [] ).every( x => x.support !== SUP.DECLARED ) )


head( '19 · Quién puede enseñar qué' )
const { kinship : kin, KINSHIP : KIN, roomKnowledge } = await import( '../src/migration/teaching.js' )
const pothosRef = { species : 'Epipremnum aureum', archetype : 'tropical' }
check( 'misma especie → todo', kin( pothosRef, pothosRef ).teaches.includes( 'resolutions' ) )
check( 'mismo arquetipo → rangos sí, cadencia no',
	kin( { species : 'Monstera deliciosa', archetype : 'tropical' }, pothosRef ).teaches.includes( 'ranges' )
	&& !kin( { species : 'Monstera deliciosa', archetype : 'tropical' }, pothosRef ).teaches.includes( 'cadence' ) )
check( 'otra cosa → solo la habitación',
	kin( { species : 'Nephrolepis', archetype : 'hygrophyte' }, pothosRef ).teaches.join() === 'room' )

const kbus = new LoopbackBus()
const mkK = async ( n, sp, days, soil ) => { const q = await createPlant( { name : n, species : sp,
	sensor : { driver : 'mock', dayNight : false }, ai : { provider : 'mock' } } )
	let z = 7; const jj = x => { z = ( z * 1103515245 + 12345 ) & 0x7fffffff; return ( z / 0x7fffffff - 0.5 ) * x }
	for ( let i = 0; i < days * 4; i++ ) await q.memory.addReading( { timestamp : Date.now() - ( days * 4 - i ) * 6 * H2,
		temperature : 21 + jj( 3 ), humidity : 62 + jj( 6 ), soil : soil + jj( 8 ), light : 650 + jj( 120 ) } )
	await q.joinColony( { transport : kbus.endpoint( n.toLowerCase() ) } ); return q }

const kElder = await mkK( 'KViejo', 'Epipremnum aureum', 120, 38 )
const kCousin = await mkK( 'KMonstera', 'Monstera deliciosa', 100, 42 )
const kFern = await mkK( 'KHelecho', 'Nephrolepis exaltata', 110, 60 )
const kNew = await mkK( 'KNuevo', 'Epipremnum aureum', 1, 40 )
const kLearn = await kNew.colony.learnFromColony()
check( 'aprende de las tres', kLearn.teachers === 3, `${kLearn.merged.lesson.biological} biológicas, ${kLearn.merged.lesson.roomOnly} solo sala` )
check( 'el helecho no arrastra el suelo', kLearn.merged.ranges.soil.max < 50, `suelo hasta ${kLearn.merged.ranges.soil.max}%` )
check( 'la sala se agrupa de todas', Object.keys( kLearn.merged.room.conditions ).length >= 3 )
check( 'el sustrato no viaja como sala', roomKnowledge( kElder ).conditions.soil === undefined )
await Promise.all( [ kElder, kCousin, kFern, kNew ].map( q => q.destroy() ) )

head( '20 · Arquetipos' )
const { guessArchetype, archetype : arch, ARCHETYPE_IDS } = await import( '../src/archetypes/index.js' )
check( 'seis arquetipos', ARCHETYPE_IDS.length === 6 )
check( 'cactus y helecho no comparten suelo', arch( 'xerophyte' ).ranges.soil.max < arch( 'hygrophyte' ).ranges.soil.min )
check( 'reconoce por nombre', guessArchetype( 'Monstera deliciosa' ).subgroup === 'aroid' )
check( 'se niega a adivinar sin base', guessArchetype( 'Xanthosoma raro' ) === null )
const { readBlueInContext : blue } = await import( '../src/spectral/index.js' )
check( 'C3: estoma cerrado = estrés', blue( 'weak', { vpd : 2.2, current : { soil : 20 } } ).state === 'closed_under_demand' )
// La luz se declara en vez de tomarla del reloj de la máquina: así se prueba la
// regla y no la hora a la que se ejecuta esto.
check( 'CAM: el mismo estoma = normal', blue( 'weak', { vpd : 2.2, current : { soil : 20, light : 12_000 }, archetype : { nocturnal : true } } ).state === 'cam_daytime_closure' )
check( 'CAM: de noche vuelve a ser un hallazgo', blue( 'weak', { vpd : 2.2, current : { soil : 20, light : 0 }, archetype : { nocturnal : true } } )?.state !== 'cam_daytime_closure' )


head( '21 · Lámparas y recetas' )
const { recipe : lampRecipe, fixtureCapability : fcap, RECIPES : RCP } = await import( '../src/spectral/index.js' )
check( 'nunca declara dosis entregada', lampRecipe( 'blue', 'probe', 'horticultural-6ch' ).delivered === null )
check( 'sonda siempre por debajo de tratamiento',
	Object.values( RCP ).filter( r => r.treat ).every( r => r.probe.level < r.treat.level ) )
check( 'sustituye longitud de onda y lo dice', lampRecipe( 'blue', 'probe', 'rgb-strip' ).substituted === true )
check( 'rechaza lo que la lámpara no puede', lampRecipe( 'farRed', 'probe', 'rgb-strip' ).usable === false )
check( 'control sham sin ámbar', lampRecipe( 'amber', 'probe', 'horticultural-6ch' ).sham === true )
check( 'lámpara blanca no puede sondear', fcap( 'single-white' ).probes.length === 0 )
check( 'bandas solo diagnósticas sin tratamiento',
	[ 'green', 'amber', 'uvA' ].every( b => RCP[ b ].treat === null ) )

head( '22 · Energía y solar' )
const { PowerBudget : PB, SolarSupply : SS } = await import( '../src/power/index.js' )
check( 'sin batería, todo corre', new PB().forecast().unlimited === true )
check( 'baja de modo al bajar la carga',
	new PB( { capacityWh : 100, charge : 0.9 } ).mode().id === 'full'
	&& new PB( { capacityWh : 100, charge : 0.05 } ).mode().id === 'survival' )
check( 'nunca apaga lo esencial', new PB( { capacityWh : 100, charge : 0.01 } ).plan().running.includes( 'sensors' ) )
const moving = new PB( { capacityWh : 100, charge : 0.9 } ).plan( { moving : true } )
check( 'al moverse, la medición espera', moving.running.includes( 'motion' ) && !moving.running.includes( 'electrode' ) )
const camNight = new PB( { capacityWh : 100, charge : 0.2, archetype : { nocturnal : true } } ).plan( { night : true } )
const c3Night = new PB( { capacityWh : 100, charge : 0.2, archetype : { nocturnal : false } } ).plan( { night : true } )
check( 'CAM: electrodo despierto de noche', camNight.running.includes( 'electrode' ) )
check( 'CAM: lámpara apagada igualmente', !camNight.running.includes( 'spectral' ) )
check( 'C3: cámara dormida de noche', !c3Night.running.includes( 'camera' ) )
check( 'viaje incluye la vuelta', new PB( { capacityWh : 10, charge : 0.3 } ).canTravel( 200 ).afford === false )
const sun = new SS( { wattsPeak : 20 } )
check( 'solar sin medir se declara estimación', sun.daily().measured === false )
for ( let i = 0; i < 15; i++ ) sun.record( 3.2 )
check( 'solar medido gana al estimado', sun.daily().measured === true )
const powered = await grow( 'Solar', { days : 3 } )
await powered.usePower( { capacityWh : 60, charge : 0.25, solar : { wattsPeak : 5 } } )
const pdiag = await powered.systemDiagnosis( { probeAI : false } )
check( 'el diagnóstico ve la energía', pdiag.checks.some( c => c.area === 'power' ) )
await powered.destroy()


// ── 3.0.4 · lo nuevo ────────────────────────────────────────────────────────

head( 'Sesión de ayuda general (no sólo luz)' )
{
	const { AidSession, aidEffect, AID, CLOSED, canOffer, crowdingRisk } =
		await import( '../src/colony/index.js' )

	check( 'toda ayuda declara qué cambia y en qué sentido',
		Object.values( AID ).every( k => {
			const e = aidEffect( k )
			return e && [ 'accumulate', 'sustain' ].includes( e.mode ) && [ 'up', 'down' ].includes( e.direction )
		} ) )
	check( 'la luz acumula, la sombra sostiene',
		aidEffect( AID.LIGHT ).mode === 'accumulate' && aidEffect( AID.SHADE ).mode === 'sustain' )

	const sh = new AidSession( { kind : AID.SHADE, effect : aidEffect( AID.SHADE ) } )
	sh.baseline( 45_000 )
	let t = Date.now()
	for ( let i = 0; i < 5; i++ ) { t += 10_000; sh.emitting( { at : t } ); sh.measuring( { value : 12_000, at : t } ) }
	check( 'la sombra se mide como caída sostenida', sh.holding.present && sh.holding.change === 33_000 )
	check( 'sin dosis, sólo termina cuando el receptor lo dice',
		sh.shouldStop( { now : t } ).stop === false && sh.shouldStop( { satisfied : true, now : t } ).stop === true )

	const lapse = new AidSession( { kind : AID.SHELTER, effect : aidEffect( AID.SHELTER ) } )
	lapse.baseline( 3.2 ); let u = Date.now()
	for ( const v of [ 0.6, 0.6, 0.6, 3.4 ] ) { u += 10_000; lapse.emitting( { at : u } ); lapse.measuring( { value : v, at : u } ) }
	check( 'si el efecto se pierde, se pierde el crédito', lapse.holding.seconds === 0 )

	const dud = new AidSession( { kind : AID.MOVE_ASIDE, effect : aidEffect( AID.MOVE_ASIDE ) } )
	dud.baseline( 300 ); let v = Date.now(); let verdict
	for ( let i = 0; i < 6; i++ ) { v += 5000; dud.emitting( { at : v } ); dud.measuring( { value : 300, at : v } ); verdict = dud.shouldStop( { now : v } ); if ( verdict.stop ) break }
	check( 'ayuda que no llega, se corta', verdict.because === CLOSED.MISMATCH )

	const midday = { body : {}, memory : { lastReading : { airflow : 0.04, light : 15_000 } } }
	const night = { body : {}, memory : { lastReading : { airflow : 0.04, light : 200 } } }
	check( 'agruparse se niega a mediodía en aire quieto', canOffer( midday, AID.HUDDLE ).able === false )
	check( 'y se permite de noche', canOffer( night, AID.HUDDLE ).able === true )
	check( 'sin anemómetro no bloquea, pero lo marca', crowdingRisk( { memory : { lastReading : { light : 15_000 } } } ).flagged === true )
}

head( 'Acoplamiento entre plantas cercanas' )
{
	const { couplingState, pocket, co2Depletion, shadeAvoidance, primingAlert, receivePriming, substrateNotes, coupled } =
		await import( '../src/colony/index.js' )

	const PAIR = { metres : 0.25, a : { temperature : 25.4, humidity : 58, leafTemperature : 23.1 }, b : { temperature : 25.6, humidity : 57 } }
	const ROOM = { temperature : 26, humidity : 42, co2 : 620 }

	check( 'sin distancia declarada no se evalúa nada', coupled( {} ).coupled === null )
	check( 'la distancia se marca como declarada, no medida', /Declared, not measured/.test( coupled( { metres : 0.2 } ).why ) )
	check( 'sin referencia externa, todo queda sin verificar',
		pocket( PAIR, null ).effects.every( e => e.observed === null ) )
	check( 'con referencia aparece la bolsa húmeda',
		pocket( PAIR, ROOM ).effects.find( e => e.effect === 'humidity-pocket' ).observed === true )
	check( 'y la caída de VPD, que es lo que hace el trabajo',
		pocket( PAIR, ROOM ).effects.find( e => e.effect === 'vpd-buffer' ).drop > 0 )
	check( 'aire quieto + luz alta = riesgo de CO2 aun sin sensor',
		co2Depletion( { airflow : 0.05, light : 14_000 } ).risk === true )
	check( 'aire en movimiento lo anula', co2Depletion( { airflow : 0.9, light : 30_000 } ).risk === false )
	check( 'sin sensor R:FR no se culpa al vecino de la elongación',
		shadeAvoidance( {} ).observed === null )

	const full = couplingState( { ...PAIR, a : { ...PAIR.a, co2 : 500, airflow : 0.04, light : 15_000 } }, ROOM )
	check( 'el veredicto pide mover el aire, no separar', /moving the air/.test( full.why ) )
	check( '"no medible" no es "no ocurre"',
		/not the same as the pairing doing nothing/.test( couplingState( PAIR, null ).why ) )

	const alert = primingAlert( { suspected : true, what : 'ácaros', from : 'ivy' }, { metres : 0.3 } )
	check( 'el aviso sale por sospecha, no por confirmación', alert.confirmed === false && alert.urgency === 'high' )
	check( 'nunca se presenta como un volátil', alert.substitute === true )
	check( 'el vecino mira antes, no trata', receivePriming( alert ).inspectWithin === 6 &&
		/would be dosing a plant for a problem it may not have/.test( receivePriming( alert ).why ) )
	check( 'maceta compartida: sólo una consecuencia es medible',
		substrateNotes( { sharedSubstrate : true, livingSubstrate : true } ).filter( n => n.measurable ).length === 1 )
}

head( 'Estados internos' )
{
	const { defenseActivation } = await import( '../src/signals/defense.js' )
	const { LEVEL, CONFIDENCE, internalStates, waterStressInternal, stressLoad, stressMemory, circadianIntegrity, state } =
		await import( '../src/states/index.js' )

	const steady = n => Array.from( { length : n }, () => ( { temperature : 22, light : 900, soil : 45 } ) )
	const draughty = [ 22, 22, 22, 17, 16, 16, 17, 18 ].map( temperature => ( { temperature, light : 900, soil : 45 } ) )
	const VP = [ { label : 'variation_potential' } ]

	const all = { ...internalStates( {} ), defense_activation : defenseActivation( {} ) }
	check( 'todo estado declara qué decisión cambia', Object.values( all ).every( s => Boolean( s.decides ) ) )
	check( 'todo estado dice qué le falta para poder responder',
		Object.values( all ).every( s => s.level !== LEVEL.UNKNOWN || Array.isArray( s.missing ) ) )
	check( 'confianza baja retira la autoridad',
		state( { name : 'x', level : LEVEL.HIGH, confidence : CONFIDENCE.LOW, decides : 'y', why : 'débil' } ).acts === false )

	check( 'ausente no es bajo', defenseActivation( {} ).level === LEVEL.UNKNOWN )
	check( 'con electrodo mirando y nada que ver, sí es bajo',
		defenseActivation( { electrode : true, readings : steady( 8 ) } ).level === LEVEL.LOW )
	check( 'un potencial de acción no es defensa',
		defenseActivation( { events : [ { label : 'action_potential' } ], readings : steady( 8 ) } ).level === LEVEL.LOW )
	check( 'dos señales del mismo electrodo no llegan a alto',
		defenseActivation( { events : VP, shift : { shifted : true }, readings : steady( 8 ) } ).level === LEVEL.MEDIUM )
	check( 'con daño visible sí',
		defenseActivation( { events : VP, shift : { shifted : true }, vision : { chewing : true }, readings : steady( 8 ) } ).level === LEVEL.HIGH )
	const cold = defenseActivation( { events : VP, shift : { shifted : true }, readings : draughty } )
	check( 'el control negativo baja la conclusión', cold.level === LEVEL.LOW && cold.downgradedFrom === LEVEL.MEDIUM )
	check( 'pero no cuando hay una causa observada',
		defenseActivation( { events : VP, shift : { shifted : true }, vision : { chewing : true }, readings : draughty } ).level === LEVEL.HIGH )
	check( 'nunca dice una concentración hormonal',
		Object.values( all ).every( s => !/level of (methyl )?jasmonate|concentration of/i.test( JSON.stringify( s ) ) ) )

	const wet = waterStressInternal( { soil : 75, stomata : { known : true, closing : true }, shift : { shifted : true } } )
	check( 'suelo mojado + planta estresada retiene el riego', wet.withhold === 'water' && wet.acts === true )
	check( 'suelo seco + planta estresada es sed corriente',
		waterStressInternal( { soil : 15, stomata : { known : true, closing : true } } ).pattern === 'agreed-thirst' )
	check( 'una sola señal no basta para retener el riego',
		waterStressInternal( { soil : 75, stomata : { known : true, closing : true } } ).acts === false )

	const elec = stressLoad( { events : { ratePerHour : 8 }, drift : { cause : 'electrode' }, episodes : 2 } )
	const phys = stressLoad( { events : { ratePerHour : 8 }, drift : { cause : 'physiology' }, episodes : 2 } )
	check( 'la deriva del electrodo no cuenta como estrés', elec.level !== LEVEL.HIGH && phys.level === LEVEL.HIGH )
	check( 'y se dice en voz alta, no se descarta en silencio',
		elec.evidence.some( e => e.signal === 'drift-discounted' ) )

	check( 'la memoria de estrés nunca pasa de medio',
		stressMemory( { hysteresis : { known : true, changed : true, verdict : 'v', caveat : 'crecimiento' } } ).level === LEVEL.MEDIUM )
	check( 'y arrastra su propia salvedad',
		stressMemory( { hysteresis : { known : true, changed : true, verdict : 'v', caveat : 'crecimiento' } } ).caveat === 'crecimiento' )

	const weak = circadianIntegrity( { health : { healthy : false, detected : true, periodHours : 24, strength : 0.18, offByHours : 0, verdict : 'v' } } )
	const off = circadianIntegrity( { health : { healthy : false, detected : true, periodHours : 31, strength : 0.6, offByHours : 7, verdict : 'v' } } )
	check( 'ritmo débil = el sistema desconfía de su propio reloj', weak.trustTiming === false )
	check( 'ritmo fuerte fuera de periodo = culpa del temporizador', off.external === true )
}

head( 'Los estados cambian decisiones de verdad' )
{
	const wet = await grow( 'Empapada', { days : 20 } )
	wet.memory.lastReading.soil = 85
	wet._lastInference = { stomata : { known : true, closing : true, why : 'cerrando antes de lo que el VPD explica' } }
	wet._lastRegime = { changed : true, baselineReady : true, why : 'electroma fuera de su base' }

	const refused = await wet.water()
	check( 'water() se niega con suelo mojado y planta estresada', refused.refused === true )
	check( 'y el rechazo lleva la evidencia', ( refused.evidence ?? [] ).length >= 2 )
	const forced = await wet.water( { force : true } )
	check( 'la anulación existe y funciona', forced.refused !== true )

	wet.perception.electro = { clock : { healthy : false, detected : true, periodHours : 24, strength : 0.15, offByHours : 0, verdict : 'v' } }
	const moment = await wet.goodMoment( 'probe' )
	check( 'con el reloj roto no se dan opiniones de horario', moment.trusted === false )

	const busy = await grow( 'Herida', { days : 20 } )
	await busy.useSpectral( { light : { driver : 'mock' } } )
	busy.spectral.sweep = async () => ( { at : new Date().toISOString(), bands : [], responses : {}, interpreted : {}, diagnosis : [], summary : 'x' } )
	busy.perception.electro = { events : [ { label : 'variation_potential' } ] }
	busy.perception.vision = { findings : { chewing : true } }
	busy._lastRegime = { changed : true, baselineReady : true }
	const probe = await busy.interrogate()
	check( 'no se sondea una planta que se está defendiendo', probe.refused === true )
	check( 'y se puede forzar si hace falta', ( await busy.interrogate( { force : true } ) ).refused !== true )

	const { canOffer, AID } = await import( '../src/colony/index.js' )
	busy._lastDefense = busy.defense()
	check( 'una planta que se defiende no se ofrece a ayudar',
		canOffer( { ...busy, body : {}, memory : busy.memory, _lastDefense : busy._lastDefense }, AID.SHELTER ).able === false )

	await Promise.all( [ wet, busy ].map( x => x.destroy() ) )
}

head( 'Capacidades, faro y priming de seguridad' )
{
	const { FACULTY, opticalLink, opticalPeers, whoCanRead, beaconMode, BEACON, frame, decode,
		prepareBeacon, onDistress, considerAlert, relevance, uvbGate, protocol, ringFor, UVB } =
		await import( '../src/colony/index.js' )

	const FAST = { id : 'willow', faculties : [ FACULTY.FAST_LIGHT ], photodiodeHz : 20_000, metrics : [ 'light' ] }
	const SLOW = { id : 'fern', faculties : [], photodiodeHz : null, metrics : [ 'light' ] }
	const ME = { id : 'ivy', faculties : [ FACULTY.SPECTRAL ] }

	check( 'silencio sobre una métrica ≠ métrica estable',
		/the instrument is missing, not that the value is steady/.test( whoCanRead( { fern : SLOW }, 'airflow' ).why ) )
	check( 'no se parpadea a un sensor de lux', opticalLink( ME, SLOW ).reason === 'slow-receiver' )
	check( 'sí a un fotodiodo rápido', opticalLink( ME, FAST ).can === true )
	check( 'no se emite a ciegas', opticalLink( ME, null ).reason === 'unknown-receiver' )
	check( 'si nadie puede oír, se avisa antes de quedarse sin batería',
		/before the battery is low rather than after/.test( opticalPeers( ME, { fern : SLOW } ).why ) )

	check( 'de día y con carga, el canal óptico está apagado',
		beaconMode( { charge : 0.8, ambientLux : 9000 } ).mode === BEACON.OFF )
	check( 'con radio averiada sube a cualquier carga',
		beaconMode( { charge : 1, radioFailed : true } ).mode === BEACON.CRITICAL )
	check( 'de noche entra en modo murmullo',
		beaconMode( { charge : 0.9, ambientLux : 0 } ).mode === BEACON.QUIET )

	const f = frame( { from : 'ivy', kind : 'sos', body : { c : 0.03 } } )
	check( 'la trama va y vuelve intacta', decode( f.bits ).ok === true && decode( f.bits ).message.from === 'ivy' )
	const bad = [ ...f.bits ]; bad[ 40 ] ^= 1
	check( 'una trama corrupta se descarta, no se cree a medias', decode( bad ).ok === false )
	const prep = prepareBeacon( ME, FAST, { kind : 'sos' }, { mode : BEACON.CRITICAL } )
	check( 'el mensaje se apunta en el ledger de dosis', prep.send === true && prep.dose.seconds > 0 && prep.band === 'amber' )
	check( 'el receptor hace de radio, no de enfermero',
		/a neighbour cannot charge it — but a person can/.test( onDistress( { from : 'ivy', kind : 'sos', body : {} } ).why ) )

	const plant = ( species, load = 'low' ) => ( {
		memory : { plant : { species } }, archetype : { id : 'tropical-understorey' },
		states : () => ( { stress_load : { level : load, acts : load !== 'low', why : 'agotada' }, defense_activation : { level : 'low', acts : false } } ),
	} )
	const near = { from : 'n', species : 'Ficus lyrata', archetype : 'tropical-understorey', metres : 0.3 }

	check( 'más allá del edificio, un aviso no informa de nada', ringFor( 500 ) === null )
	check( 'sin distancia declarada, peso cero', relevance( { species : 'Ficus lyrata' }, plant( 'Ficus lyrata' ) ).weight === 0 )
	const d = considerAlert( plant( 'Ficus lyrata' ), near )
	check( 'R:FR se mantiene ALTO, no bajo', d.redFarRed.hold === 'high' )
	check( 'y se explica por qué bajarlo apagaría la defensa',
		/suppresses jasmonate and salicylate responsiveness/.test( d.redFarRed.why ) )
	check( 'una planta ya agotada no se prepara',
		considerAlert( plant( 'Ficus lyrata', 'high' ), near ).blocked === 'stress_load' )
	check( 'UV-B apagado por defecto', d.uvb.reason === 'not-enabled' )

	const withUvb = { ...plant( 'Ficus lyrata' ), spectral : { light : { channels : [ 'uvb' ] }, safety : { usedToday : () => 0 } } }
	const rel = relevance( near, plant( 'Ficus lyrata' ) )
	check( 'UV-B espera a que la sala esté vacía',
		uvbGate( withUvb, rel, { allowUvb : true, occupied : true } ).reason === 'occupied' )
	check( 'el tope diario no lo puede subir quien llama',
		uvbGate( { ...withUvb, spectral : { ...withUvb.spectral, safety : { usedToday : () => UVB.maxSecondsPerDay } } }, rel, { allowUvb : true } ).reason === 'daily-cap' )
	check( 'con todo satisfecho, se permite', uvbGate( withUvb, rel, { allowUvb : true, occupied : false } ).allowed === true )

	const plan = protocol( d )
	check( 'el aire va primero, por gratis', plan[ 0 ].phase === 'airflow' )
	check( 'siempre hay retirada', plan.at( -1 ).phase === 'stand-down' )
	check( 'el electrodo observa, no acciona', plan.find( x => x.phase === 'watch' ).action.electrode === 'observe' )
}

head( 'Navegación' )
{
	const { canCross, worthMoving, planMove, REFUSAL, Surveyor, ros2Surveyor } =
		await import( '../src/navigation/index.js' )
	const tall = { heightM : 2, baseM : 0.35, wheelbaseM : 0.4 }

	check( 'un umbral que un robot cruzaría vuelca una planta alta', canCross( tall, { stepM : 0.04 } ).safe === false )
	check( 'uno pequeño no', canCross( tall, { stepM : 0.01 } ).safe === true )
	check( 'sin geometría declarada, no se adivina', canCross( {}, { stepM : 0.04 } ).safe === null )
	check( 'destino sin medir no es un plan', worthMoving( { light : 400 }, null, {} ).better === null )
	const trade = worthMoving( { light : 400, temperature : 21, airflow : 0.1 }, { light : 9000, temperature : 14, airflow : 0.9 }, { metric : 'light' } )
	check( '"ir hacia la luz" se detecta como intercambio, no mejora', trade.better === false && trade.costs.length === 2 )

	const base = { memory : { lastReading : { light : 400 } }, chassis : tall, states : () => ( {} ) }
	const infested = await planMove( base, { to : {}, there : { light : 2000 }, want : { metric : 'light' }, neighbours : [ { id : 'f', biotic : true, metres : 0.3 } ] } )
	check( 'no se llega junto a un vecino infestado', infested.refusals.some( x => x.reason === REFUSAL.BIOTIC ) )
	const nomap = await planMove( base, { to : {}, there : { light : 2000 }, want : { metric : 'light' } } )
	check( 'sin mapa se niega, y dice que sólo falta eso',
		nomap.refusals[ 0 ].reason === REFUSAL.NO_MAP && /only the navigation is missing/.test( nomap.refusals[ 0 ].why ) )
	const withMap = await planMove( base, { to : {}, there : { light : 2000 }, want : { metric : 'light' } },
		{ surveyor : Object.assign( new Surveyor(), { pathTo : async () => ( { found : true } ) } ) } )
	check( 'con topógrafo, adelante', withMap.go === true )
	check( 'una ruta parcial no es una ruta',
		/a partial path is not a path/.test( ( await ros2Surveyor( { call : async () => ( { error : 'x' } ) } ).pathTo( {} ) ).why ) )
}

head( 'El panel' )
{
	const { snapshot, vitals, band, BAND } = await import( '../src/dashboard/index.js' )
	const shown = await grow( 'Panel', { days : 20 } )

	const rows = vitals( shown )
	check( 'las métricas sin sensor se listan, no se ocultan', rows.some( v => !v.measured ) )
	check( 'la procedencia no entra en las constantes',
		![ 'src', 't', 'timestamp', 'at' ].some( k => rows.map( x => x.metric ).includes( k ) ) )
	check( 'sin rango, la banda es desconocida — no "bien"', band( 22, null ).band === BAND.UNKNOWN )

	const snap = await snapshot( shown )
	check( '"lo que falta" es un apartado, no una nota al pie', Array.isArray( snap.missing.metrics ) )
	check( 'los estados llevan si pueden actuar', Object.values( snap.states ).every( s => typeof s.acts === 'boolean' ) )

	const srv = await shown.serve( { port : 7903 } )
	check( 'escucha en loopback y sin avisos', srv.host === '127.0.0.1' && srv.warnings.length === 0 )
	check( 'sólo lectura', srv.readOnly === true )
	check( 'GET responde', ( await fetch( `${srv.url}/vitals.json` ) ).status === 200 )
	check( 'POST se rechaza', ( await fetch( `${srv.url}/vitals.json`, { method : 'POST' } ) ).status === 405 )
	check( 'el logo se sirve como fichero', ( await fetch( `${srv.url}/logo.png` ) ).status === 200 )
	const html = await ( await fetch( srv.url ) ).text()
	check( 'la página no pide nada a internet', !/https?:\/\//.test( html.replace( /https?:\/\/www\.w3\.org[^"']*/g, '' ) ) )
	check( 'y no hace scroll', /html, body \{ height:100%; overflow:hidden \}/.test( html ) )

	const open = await shown.serve( { port : 7904, host : '0.0.0.0' } )
	check( 'salir de loopback avisa en palabras llanas', /whether anybody is home/.test( open.warnings[ 0 ] ) )
	await open.close()

	const leaky = await createPlant( { name : 'Secreta', species : 'Ficus', sensor : { driver : 'mock' }, ai : { provider : 'openai', apiKey : 'sk-no-debe-salir' } } )
	await leaky.read()
	check( 'ninguna credencial sale en el payload',
		!JSON.stringify( await snapshot( leaky ) ).includes( 'sk-no-debe-salir' ) )
	await leaky.destroy()
	await shown.destroy()
}

head( 'El diagnóstico ve todo lo nuevo' )
{
	const bare = await grow( 'Pelada', { days : 20 } )
	const d1 = await bare.systemDiagnosis( { probeAI : false } )
	const areas = d1.checks.map( c => c.area )
	for ( const a of [ 'states', 'coupling', 'optical', 'security', 'navigation', 'dashboard' ] ) {
		check( `el diagnóstico cubre "${a}"`, areas.includes( a ) )
	}
	check( 'todo rojo y amarillo termina en algo que hacer',
		d1.checks.filter( c => c.result === 'fail' || c.result === 'warn' ).every( c => Boolean( c.fix ) ) )
	// Una línea "no configurado" puede sugerir algo — lo que no puede es contar
	// como avería ni colarse en la lista de arreglos.
	check( 'no configurado no es roto',
		d1.checks.filter( c => c.result === 'absent' ).length > 0
		&& !d1.fixes.some( f => d1.checks.find( c => c.area === f.area )?.result === 'absent' )
		&& d1.ok === ( d1.counts.fail === 0 ) )
	check( 'el estado sin instrumento nombra el instrumento',
		/Waiting on an instrument|electrode/.test( d1.checks.find( c => c.area === 'states' ).says + ( d1.checks.find( c => c.area === 'states' ).fix ?? '' ) ) )

	const rolling = await grow( 'Rodante', { days : 20 } )
	rolling.body = { drive : {} }
	const d2 = await rolling.systemDiagnosis( { probeAI : false } )
	check( 'una planta que se mueve sin geometría se marca en rojo',
		d2.checks.find( c => c.area === 'navigation' ).result === 'fail' )

	await Promise.all( [ bare, rolling ].map( x => x.destroy() ) )
}



// ── 3.0.5 · maceta, trasplante y espacio de raíz ────────────────────────────

head( 'La maceta como parte del cuerpo' )
{
	const { dose, pumpSeconds, confirm } = await import( '../src/archetypes/watering.js' )
	const { rootSpace, ROOT_SPACE, dryingRate } = await import( '../src/archetypes/rootspace.js' )
	const { start, assess, RESETS, PHASE, MAX_SETTLING_DAYS } = await import( '../src/archetypes/transplant.js' )

	// La corrección de fondo: el volumen lo decide la maceta, no la especie.
	const small = dose( { archetype : 'tropical', pot : { diameterCm : 12 } } )
	const big = dose( { archetype : 'tropical', pot : { diameterCm : 40 } } )
	check( 'la misma especie en dos macetas difiere en un orden de magnitud',
		big.ml / small.ml > 20, `${small.ml}ml vs ${big.ml}ml` )
	check( 'sin maceta no se da número', dose( { archetype : 'tropical' } ).known === false )
	check( 'sin arquetipo tampoco', dose( { pot : { diameterCm : 20 } } ).known === false )
	check( 'cactus y helecho quieren lo contrario',
		dose( { archetype : 'hygrophyte', subgroup : 'fern', pot : { diameterCm : 20 } } ).dryBackTo
			> dose( { archetype : 'xerophyte', subgroup : 'cactus', pot : { diameterCm : 20 } } ).dryBackTo * 5 )
	check( 'los segundos se miden, no se consultan', pumpSeconds( 450, {} ).known === false )
	check( 'y con caudal medido sí', pumpSeconds( 450, { mlPerSecond : 30 } ).seconds === 15 )
	check( 'una bomba que corrió sin mover el suelo es una avería',
		confirm( null, 42, 43 ).fault === true )
	check( 'sin sonda no se afirma que llegó', confirm( null, undefined, 40 ).arrived === null )

	// Espacio de raíz: nunca actúa, y no ve raíces.
	const HOUR = 3600_000, D = 86_400_000
	const potted = await createPlant( {
		name : 'Tiesto', species : 'Ficus lyrata',
		sensor : { driver : 'mock' }, ai : { provider : 'mock' },
		pot : { litres : 2, since : new Date( Date.now() - 200 * D ).toISOString() },
	} )

	let soil = 60
	for ( let h = 0; h < 200 * 24; h += 6 ) {
		const at = Date.now() - 200 * D + h * HOUR
		const late = h > 200 * 24 * 0.25
		soil -= ( late ? 4 : 1.5 ) / 4
		if ( soil < 20 ) { soil = 60; await potted.memory.addEvent( 'water', { at : new Date( at ).toISOString() } ) }
		await potted.memory.addReading( { timestamp : at, soil, temperature : 22, humidity : 55, light : 900 } )
	}

	const rs = potted.rootSpace()
	check( 'una maceta que se llena se nota en cómo seca',
		[ ROOT_SPACE.LOW, ROOT_SPACE.MEDIUM ].includes( rs.index ), `${rs.index} · ${rs.outlook}` )
	check( 'y nunca actúa por su cuenta', rs.acts === false )
	check( 'la evidencia es auditable', rs.evidence.length > 0,
		rs.evidence.map( e => e.detail ).join( ' · ' ).slice( 0, 90 ) )
	check( 'la tasa de secado se mide sobre tramos de secado', dryingRate( potted.memory.data.readings ).known === true )

	potted.maintenance = () => ( { condition : 'degraded' } )
	check( 'una sonda degradada se descuenta en voz alta',
		potted.rootSpace().evidence.some( e => e.signal === 'instrument-discounted' ) )
	delete potted.maintenance

	// Trasplante: el usuario sólo da los litros.
	check( 'el trasplante exige el volumen y nada más', start( {}, {} ).started === false )
	const antes = potted.wateringPlan().ml
	await potted.transplant( { volumeL : 8 } )
	check( 'reescala el riego', potted.wateringPlan().ml > antes * 2 )
	check( 'cierra la banda de suelo vieja', potted.ranges.soil === undefined )
	check( 'suspende el índice de raíz', potted.rootSpace().settling === true )
	check( 'lo electivo espera', potted.mayI( 'probe' ).allowed === false )
	check( 'el cuidado nunca espera', potted.mayI( 'water' ).allowed === true )
	check( 'la calibración sobrevive al cambio de maceta',
		Object.values( RESETS ).filter( r => !r.resets ).length >= 4 && RESETS.calibration.resets === false )
	check( 'aparece en el feed de actividad',
		potted.activity.recent( { kind : 'care' } ).some( e => e.label === 'Transplant started' ) )

	// Asentamiento: por lecturas, no por calendario. Con una planta limpia,
	// porque mover la frontera hacia atrás sobre 200 días de historial haría que
	// las lecturas de la maceta vieja contaran como nuevas — cosa que no puede
	// pasar de verdad, pero que arruina la simulación.
	const moved = await createPlant( {
		name : 'Recién movida', species : 'Ficus lyrata',
		sensor : { driver : 'mock' }, ai : { provider : 'mock' },
		pot : { litres : 1 },
	} )
	await moved.transplant( { volumeL : 5 } )
	const t = moved._transplant
	t.at = Date.now() - 9 * D
	t.boundary = t.at
	for ( let i = 0; i < 60; i++ ) {
		await moved.memory.addReading( {
			timestamp : t.at + i * 3 * HOUR,
			soil : i < 30 ? 40 + ( i % 2 ? 25 : -25 ) : 45 + ( i % 3 ),
			temperature : 22, humidity : 55, light : 900,
		} )
	}
	const settled = moved.transplantStatus()
	check( 'cierra cuando la maceta encuentra su ritmo', settled.phase === PHASE.SETTLED,
		settled.why.slice( 0, 80 ) )
	check( 'y adopta las nuevas bases', settled.baselines === 'adopted' )
	await moved.destroy()

	const stuck = assess( { memory : { data : { readings : Array.from( { length : 60 }, ( _, i ) => ( {
		t : new Date( Date.now() - ( MAX_SETTLING_DAYS + 2 ) * D + i * 6 * HOUR ).toISOString(),
		soil : 40 + ( i % 2 ? 25 : -25 ),
	} ) ) } } }, {
		phase : PHASE.SETTLING,
		at : Date.now() - ( MAX_SETTLING_DAYS + 2 ) * D,
		boundary : Date.now() - ( MAX_SETTLING_DAYS + 2 ) * D,
		volumeL : 5,
	} )
	check( 'no se queda cauteloso para siempre', stuck.settled === true )

	await potted.destroy()
}

head( 'La terminal, tras el rediseño' )
{
	const shown = await grow( 'Pantalla', { days : 20 } )
	const { snapshot } = await import( '../src/dashboard/index.js' )
	const snap = await snapshot( shown )

	check( 'el panel lleva actividad', Array.isArray( snap.activity ) )
	check( 'y espacio de raíz', 'rootSpace' in snap )
	check( 'y plan de riego', 'watering' in snap )

	const srv = await shown.serve( { port : 7931 } )
	const html = await ( await fetch( srv.url ) ).text()
	check( 'tres páginas más la de colonia', /data-page="activity"/.test( html ) && /data-page="detail"/.test( html ) )
	check( 'la línea de la planta es una sola', /white-space:nowrap/.test( html ) )
	check( 'las tarjetas van en cuatro columnas', /grid-template-columns:repeat\( ?4,1fr\)/.test( html ) )
	check( 'el dashboard no hace scroll', /#page-dashboard \{ overflow:hidden/.test( html ) )
	check( 'la consola separada ya no existe', !/id="console"/.test( html ) )
	check( 'y el feed fusiona lecturas con eventos', /isEvent/.test( html ) )
	await srv.close()
	await shown.destroy()
}


head( 'Los cinco plugins nuevos, sobre una sola planta' )
{
	const full = await createPlant( {
		name : 'Completa', species : 'Ficus lyrata',
		sensor : { driver : 'mock', dayNight : false },
		ai : { provider : 'mock' },
		hemisphere : 'north',
		pot : { litres : 2, since : new Date( Date.now() - 400 * DAY ).toISOString() },
		power : { capacityWh : 100, solar : { wattsPeak : 20 } },
	} )

	const bus = new LoopbackBus()
	const names = [
		'watering', 'alerts', 'history', 'lighting', 'ventilation', 'stress',
		'pests', 'fertilizer', 'diary', 'simulator', 'spectrum', 'migration',
		'transplant', 'thermal', 'presence', 'season', 'energy',
	]
	for ( const n of names ) await full.use( ( await import( `@smartplant/${n}` ) ).default )
	await full.use( ( await import( '@smartplant/colony' ) ).default, { transport : bus.endpoint( 'completa' ) } )
	await full.read()

	check( 'los dieciocho conviven en un mismo kernel', full.plugins.size === 18, `${full.plugins.size} instalados` )

	// Cada uno responde sin hardware, y responde negándose.
	const season = await full.plugin( 'season' ).ranges()
	check( 'season dobla las bandas con hemisferio', season.applied === true, `${season.season} al ${Math.round( season.weight * 100 )}%` )

	const energy = full.plugin( 'energy' )
	check( 'energy rechaza un porcentaje mal pasado', energy.charge( 85 ).accepted === false )
	energy.charge( 1 )
	const lit = energy.plan( { night : true } )
	check( 'y apaga la lámpara de noche con la batería llena', !lit.running.includes( 'spectral' ) )
	check( 'y cuenta el viaje de vuelta', energy.canTravel( 4000 ).afford === false )

	const presence = full.plugin( 'presence' )
	check( 'presence bloquea UV-B sin radio', presence.uvbAllowed().allowed === false,
		presence.uvbAllowed().why.slice( 0, 60 ) )

	let n = 0
	const radio = await full.attachSensor( {
		driver : 'presence', sensing : 'rssi',
		sample : async () => 40 + ( ( n++ % 7 ) - 3 ) * 0.4,
	} )
	for ( let i = 0; i < 60; i++ ) await radio.read()
	check( 'y lo permite cuando la sala lee vacía', presence.uvbAllowed().allowed === true )

	const thermal = full.plugin( 'thermal' )
	check( 'thermal se niega sin cámara', ( await thermal.stress() ).known === false )

	const W = 64, H = 48
	const frame = ( canopy, spread, wall ) => {
		const data = new Float32Array( W * H )
		for ( let i = 0; i < data.length; i++ ) {
			const x = i % W, y = Math.floor( i / W )
			data[ i ] = ( x > 12 && x < 50 && y > 8 && y < 40 )
				? canopy + ( ( x + y ) % 5 ) * spread / 5
				: wall + ( i % 7 ) * 0.05
		}
		return { width : W, height : H, data }
	}
	let hot = false
	const cam = await full.attachSensor( {
		driver : 'thermal',
		frame : async () => hot ? frame( 21, 25, 30 ) : frame( 21.2, 0.5, 23 ),
	} )
	await cam.read()
	await full.read()
	full.memory.lastReading.temperature = 23

	const cool = await thermal.stress()
	check( 'una copa fría es una planta con agua que gastar', cool.known && cool.index < 0.3, `índice ${cool.index}` )
	hot = true
	await cam.read()
	const uneven = await thermal.evenness()
	check( 'y ve media copa parada, que una pinza no vería', uneven.even === false, `${uneven.spread}°C de diferencia` )
	check( 'el mapa es relativo a propósito', ( await thermal.map() ).relative === true )

	const tr = full.plugin( 'transplant' )
	check( 'transplant aconseja mirar antes que actuar', /Look at the rootball/.test( tr.plan().checks[ 0 ] ) )
	check( 'y avisa contra una maceta demasiado grande', tr.plan().suggest === 5 )

	head( 'El diagnóstico, con todo conectado' )
	const diag = await full.systemDiagnosis( { probeAI : false } )
	const areas = diag.checks.map( c => c.area )

	for ( const a of [
		'transplant', 'thermal', 'activity', 'consolidation', 'provenance', 'profile',
		'season', 'pot', 'root-space', 'presence', 'states', 'coupling', 'optical',
		'security', 'navigation', 'spatial', 'dashboard', 'learning', 'delivery',
		'coadaptation', 'continuity-of-self', 'identity', 'experiments', 'plugins',
	] ) check( `diagnostica ${a}`, areas.includes( a ) )

	check( 'ninguna capa nueva queda fuera', areas.length >= 39, `${areas.length} áreas` )
	check( 'y ninguna se repite', new Set( areas ).size === areas.length )
	check( 'nada roto con todo enchufado', diag.counts.fail === 0,
		diag.checks.filter( c => c.result === 'fail' ).map( c => c.area ).join( ', ' ) || 'sin fallos' )

	const mudo = diag.checks.filter( c => ( c.result === 'warn' || c.result === 'fail' ) && !c.fix )
	check( 'toda línea roja o ámbar acaba en algo que hacer', mudo.length === 0,
		mudo.map( c => c.area ).join( ', ' ) || 'todas con arreglo' )

	const term = ( await import( '../src/diagnosis/index.js' ) ).formatDiagnosis( diag )
	check( 'y se imprime entero en una terminal', term.split( '\n' ).length > 40 )

	// La térmica ahora tiene aire y fotograma: debe opinar de verdad.
	const th = diag.checks.find( c => c.area === 'thermal' )
	check( 'la térmica opina, no se excusa', th.result !== 'absent', th.says.slice( 0, 70 ) )

	const plug = diag.checks.find( c => c.area === 'plugins' )
	check( 'y el diagnóstico nombra los 18 plugins', /transplant/.test( plug.says ) && /energy/.test( plug.says ) )

	await full.destroy()
}

head( 'Un montaje a medias, que es como llega la gente' )
{
	const half = await createPlant( {
		name : 'A medias', species : 'Ficus lyrata',
		sensor : { driver : 'mock', dayNight : false },
		ai : { provider : 'mock' },
	} )
	await half.use( ( await import( '@smartplant/season' ) ).default )
	await half.use( ( await import( '@smartplant/energy' ) ).default )
	await half.read()

	const d = await half.systemDiagnosis( { probeAI : false } )
	const plug = d.checks.find( c => c.area === 'plugins' )

	check( 'avisa de los plugins que no pueden hacer nada todavía', plug.result === 'warn' )
	check( 'y dice qué le falta a cada uno', /season wants/.test( plug.fix ) && /energy wants/.test( plug.fix ) )
	check( 'sin llamar roto a lo que nadie pidió', d.counts.fail === 0 )

	await half.destroy()
}


head( 'Celsius o Fahrenheit, sin que la unidad viaje con el número' )
{
	const cel = await createPlant( {
		name : 'Celsius', species : 'Ficus lyrata',
		sensor : { driver : 'mock', dayNight : false },
		ai : { provider : 'mock' },
	} )
	const fah = await createPlant( {
		name : 'Fahrenheit', species : 'Ficus lyrata',
		sensor : { driver : 'mock', dayNight : false },
		ai : { provider : 'mock' },
		units : 'imperial',
	} )
	await cel.read()
	await fah.read()

	check( 'por defecto grados centígrados', /°C/.test( cel.status() ) && cel.units === 'metric' )
	check( 'y Fahrenheit cuando se pide', /°F/.test( fah.status() ) && !/°C/.test( fah.status() ) )
	check( 'pero por dentro sigue siendo Celsius', fah.memory.lastReading.temperature < 40,
		`${fah.memory.lastReading.temperature}°C almacenados` )

	// El emoji se elige sobre el valor Celsius contra la banda Celsius. Comparar
	// un número Fahrenheit con un rango Celsius pondría a todas las plantas del
	// mundo imperial ardiendo para siempre.
	check( 'y el emoji no se calcula sobre el número mostrado', !/🔥/.test( fah.status() ) )

	const { snapshot : snapUnits } = await import( '../src/dashboard/vitals.js' )
	const payload = await snapUnits( fah )
	check( 'el panel recibe Celsius y una instrucción de pantalla',
		payload.units === 'imperial' && payload.vitals.find( v => v.metric === 'temperature' ).value < 40 )

	// Una sonda que envía Fahrenheit es un hecho del cable, no una preferencia
	// de pantalla, y se convierte una sola vez en la frontera.
	const probe = await createPlant( {
		name : 'Sonda', species : 'Ficus lyrata',
		sensor : { driver : 'manual', unit : 'F', initial : { temperature : 72, humidity : 55, soil : 40, light : 400 } },
		ai : { provider : 'mock' },
		units : 'imperial',
	} )
	await probe.read()
	check( 'una sonda en Fahrenheit se convierte en el cable', probe.memory.lastReading.temperature === 22.22 )
	check( 'y no se convierte dos veces por tener la pantalla en Fahrenheit', /72°F/.test( probe.status() ) )

	// Y la sonda mal declarada, que es el error de verdad.
	const wrong = await createPlant( {
		name : 'Mal declarada', species : 'Ficus lyrata',
		sensor : { driver : 'manual', initial : { temperature : 72, humidity : 55, soil : 40, light : 400 } },
		ai : { provider : 'mock' },
	} )
	const du = ( await wrong.systemDiagnosis( { probeAI : false } ) ).checks.find( c => c.area === 'units' )
	check( 'una sonda mal declarada se denuncia, no se reescala', du.result === 'fail',
		du.says.slice( 0, 70 ) )
	check( 'y el arreglo está en el cable', /unit: "F"/.test( du.fix ) )

	await Promise.all( [ cel, fah, probe, wrong ].map( x => x.destroy() ) )
}


await Promise.all( [ p, heir, stuckPlant, solo, c1, c2, live ].map( x => x.destroy() ) )
console.log( `\n${'─'.repeat( 50 )}` )
console.log( fail === 0 ? `\x1b[32m✓ ${pass}/${pass + fail} comprobaciones OK\x1b[0m` : `\x1b[31m✗ ${fail} fallo(s) de ${pass + fail}\x1b[0m` )
process.exit( fail ? 1 : 0 )

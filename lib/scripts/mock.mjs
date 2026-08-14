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


await Promise.all( [ p, heir, stuckPlant, solo, c1, c2, live ].map( x => x.destroy() ) )
console.log( `\n${'─'.repeat( 50 )}` )
console.log( fail === 0 ? `\x1b[32m✓ ${pass}/${pass + fail} comprobaciones OK\x1b[0m` : `\x1b[31m✗ ${fail} fallo(s) de ${pass + fail}\x1b[0m` )
process.exit( fail ? 1 : 0 )

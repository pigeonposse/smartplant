# Full API surface

```js
// Sensing
plant.read( opts )                    plant.attachSensor( spec )
plant.getSensor( id )                 plant.registerSensor( id, driver )
plant.status()                        plant.happiness()
plant.context()                       plant.perceive()

// Multimodal
plant.useVision( config )             plant.see( opts )
plant.listen( opts )
plant.useSpectral( config )           plant.interrogate( opts )
plant.useBrain( config )              plant.brain.run( goal )

// The plant on its own terms   (all returned by plant.listen)
signal.fingerprint · signal.shift     signal.clock · signal.coherence
plant.electrome                       plant.context().vpd / .vpdBand

// AI & reasoning
plant.analyze( question, opts )       plant.speak( message, opts )
plant.learnSpecies()                  plant.diagnose( opts )
plant.remember( note )                plant.recall( query, opts )

// Colony
plant.joinColony( { transport } )     plant.leaveColony()
plant.colony.enabled                  // false until you join
plant.colony.report( { to } )         plant.colony.ask( peer, skill )
plant.colony.askAll( skill )          plant.colony.lexicon
plant.colony.newcomers()              plant.colony.teach( peer )
plant.colony.learnFromColony()

// Colony: doing something, not just saying it
plant.colony.openAidSession( peer, { kind, target } )
plant.colony.streamAid( id, { target, satisfied } )
plant.colony.coupling( { reading, metres }, reference )
plant.colony.warnNeighbours( { near } )
plant.colony.primed                   canOffer( plant, AID.HUDDLE )

// Reading the space
plant.attachSensor( { driver: 'presence', sensing: 'csi', sample } )
plant.attachSensor( { driver: 'lidar', scan } )
readSpace( scan, { neighbours, radius, previous } )
rangeTo( scan, { id, bearing } )     clearance( scan )
whatChanged( before, after )         motionExplains( history, at )

// Colony: a second way through
plant.colony.addLink( transport, { name, priority, costsReceiver } )
plant.colony.deliveryHealth()        plant.colony.retryUndelivered()
plant.colony.undelivered             // every send that did not arrive

// Colony: capability, light and priming
plant.colony.manifest                 plant.colony.whoCanRead( metric )
plant.colony.canSignal( peer )        plant.colony.opticalPeers()
beaconMode( { charge, radioFailed, ambientLux } )
prepareBeacon( sender, receiver, msg, { mode } )
considerAlert( plant, alert )         protocol( decision )

// Navigation — the constraints, not the planner
canCross( chassis, obstacle )         worthMoving( here, there, want )
planMove( plant, move, { surveyor } ) ros2Surveyor( bridge )

// The plant in a browser
plant.serve( { port, host, everyMs } )
snapshot( plant, { deep } )           vitals( plant )

// Being wrong about itself
plant.mayI( action, { force } )       plant.posture()
plant.settleTrial( trial )            plant.trajectory()
plant.exportIdentity()                plant.restoreIdentity( bundle, opts )

// Internal states — what the plant is doing
plant.states()                        plant.defense()
// → { level, confidence, acts, evidence[], decides, why }

// Experience
plant.whatWorkedBefore( problem )     plant.resolutions.report()

// Looking at itself
plant.systemDiagnosis( opts )         plant.checkup( { period } )
plant.maintenance()
plant.runDueReviews()

// Learning it is wrong
plant.body.personalization.predictions.report()
new ContinuityTracker().attribute()   hysteresis( history, episode )
plant.learnInterventions( opts )      plant.interventions.identify( samples, rate )
regimeChange( history )               collectiveState( members )
collectiveShift( before, after )      infectionWatch( signals )

// Inheritance
plant.exportInheritance( opts )       plant.inherit( bundle, opts )
plant.inheritance.blend( action )     plant.inheritance.report()

// Care
plant.water()   plant.fertilize()   plant.log( type )   plant.note( text )

// Embodiment
plant.embody( config )                plant.justifies( claim, risk )
plant.body.state   plant.body.safety   plant.body.control
plant.body.evidence                   plant.body.personalization

// Lifecycle
plant.init()    plant.startMonitoring()   plant.stopMonitoring()   plant.destroy()
plant.use( plugin )   plant.plugin( name )   plant.on( event, fn )
```

**Subpath exports:** `smartplant/signals` · `/vision` · `/knowledge` · `/integrations` · `/integrations/openclaw` · `/firmware` · `/federated` · `/migration` · `/colony` · `/prediction` · `/checkup` · `/maintenance` · `/diagnosis` · `/resolutions` · `/fusion` · `/control` · `/safety` · `/confidence` · `/personalization` · `/hardware` · `/spectral` · `/sensors` · `/memory` · `/voice` · `/plugin`

Runnable examples live in [`lib/examples/`](https://github.com/pigeonposse/smartplant/tree/main/lib/examples) — all twelve work with no hardware and no API key.

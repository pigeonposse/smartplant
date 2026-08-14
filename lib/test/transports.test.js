/**
 * The transports, along the path where they work.
 *
 * Serial and MQTT had only ever been exercised by failing to connect. Every
 * line past that — parsing a frame, mapping it onto metrics, ageing it out,
 * feeding it into a reading — had never run outside a mock, and mocking the
 * client would only prove that a stub calls a stub.
 *
 * So neither is mocked. The MQTT client talks to a real broker over a real
 * socket, using the same `mqtt` package a user would install. The serial driver
 * opens a real device file — a pseudo-terminal, which is what the operating
 * system hands you when you ask for a serial port with nothing plugged in.
 * `serialport` cannot tell the difference, which is the whole point.
 *
 * The serial half needs `python3` for the pseudo-terminal and is skipped where
 * that is missing. The MQTT half is pure Node and always runs.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { after, describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { topicMatches } from '../src/sensors/drivers/mqtt.js'
import { startBroker } from './helpers/mqtt-broker.js'

const wait = ms => new Promise( r => setTimeout( r, ms ) )
const shut = []

after( async () => {

	for ( const f of shut ) await f()?.catch?.( () => {} )

} )

/** Whether a pseudo-terminal can be opened here at all. */
const hasPty = await new Promise( resolve => {

	const child = spawn( 'python3', [ '-c', 'import pty' ] )
	child.on( 'error', () => resolve( false ) )
	child.on( 'exit', code => resolve( code === 0 ) )

} )

/**
 * A device on the other end of a real serial port, repeating frames.
 *
 * @param   {string[]} lines - What the device says, in order, forever.
 * @returns {Promise<object>} `{path, close}`.
 */
async function virtualDevice( lines ) {

	const py = `
import os, pty, sys, time
master, slave = pty.openpty()
sys.stdout.write(os.ttyname(slave) + "\\n"); sys.stdout.flush()
frames = ${JSON.stringify( lines )}
i = 0
while True:
    try:
        os.write(master, (frames[i % len(frames)] + "\\r\\n").encode())
    except OSError:
        break
    i += 1
    time.sleep(0.12)
`
	const child = spawn( 'python3', [ '-c', py ] )

	const path = await new Promise( ( resolve, reject ) => {

		const timer = setTimeout( () => reject( new Error( 'the pseudo-terminal never reported a path' ) ), 5000 )
		child.stdout.once( 'data', d => {

			clearTimeout( timer )
			resolve( String( d ).trim() )

		} )
		child.stderr.once( 'data', d => {

			clearTimeout( timer )
			reject( new Error( String( d ) ) )

		} )

	} )

	const handle = {
		path,
		close : () => child.kill(),
	}
	shut.push( () => handle.close() )
	return handle

}

const plantOn = async ( name, sensor ) => {

	const p = await createPlant( {
		name,
		species : 'Ficus',
		sensor,
		ai : { provider : 'mock' },
	} )
	shut.push( () => p.destroy() )
	return p

}

describe( 'serial, over a real port', { skip : hasPty ? false : 'python3 with pty is not available here' }, () => {

	it( 'carries a JSON frame from the wire into a reading', async () => {

		const dev = await virtualDevice( [ '{"temperature":21.7,"humidity":58.2,"light":9400}' ] )
		const plant = await plantOn( 'Serial', {
			driver : 'serial',
			path : dev.path,
		} )

		assert.equal( plant.sensors.peek( 'serial' ).connected, true )

		await wait( 600 )
		const r = await plant.read()

		assert.equal( r.temperature, 21.7 )
		assert.equal( r.humidity, 58.2 )
		assert.equal( r.light, 9400 )

	} )

	it( 'carries a CSV frame too', async () => {

		const dev = await virtualDevice( [ '22.9,61.4,10200' ] )
		const plant = await plantOn( 'CSV', {
			driver : 'serial',
			path : dev.path,
			fields : [ 'temperature', 'humidity', 'light' ],
		} )

		await wait( 600 )
		const r = await plant.read()

		assert.equal( r.temperature, 22.9 )
		assert.equal( r.light, 10_200 )

	} )

	it( 'ignores rubbish on the line without losing the good frame', async () => {

		// Which is the normal condition of a serial line: a half-written frame at
		// startup, a truncated line, a device rebooting mid-sentence.
		const dev = await virtualDevice( [ ' ÿ garbage', '{"temperature":19.5}', 'not,a,number' ] )
		const plant = await plantOn( 'Noise', {
			driver : 'serial',
			path : dev.path,
		} )

		await wait( 800 )
		const r = await plant.read()

		assert.equal( r.temperature, 19.5 )

	} )

	it( 'goes stale rather than repeating a value from a device that stopped', async () => {

		const dev = await virtualDevice( [ '{"temperature":20.1}' ] )
		const plant = await plantOn( 'Gone', {
			driver : 'serial',
			path : dev.path,
		} )

		await wait( 500 )
		assert.equal( ( await plant.read() ).temperature, 20.1 )

		plant.sensors.peek( 'serial' ).staleAfter = 200
		dev.close()
		await wait( 500 )

		// The dangerous alternative is a driver that keeps serving the last value
		// forever, so a dead sensor looks like a perfectly stable one.
		await assert.rejects( () => plant.read(), /stale/ )

	} )

} )

describe( 'the electrode over that same real port', { skip : hasPty ? false : 'python3 with pty is not available here' }, () => {

	it( 'buffers samples that arrived down a wire, not from a simulator', async () => {

		const samples = Array.from( { length : 40 }, ( _, i ) =>
			String( ( -62 + Math.sin( i / 3 ) * 1.5 ).toFixed( 3 ) ) )
		const dev = await virtualDevice( samples )

		const plant = await plantOn( 'Electrode', { driver : 'mock' } )
		const electrode = await plant.attachSensor( {
			driver : 'electrode',
			transport : 'serial',
			path : dev.path,
			sampleRate : 10,
			bufferSeconds : 60,
			mainsHz : 0,
		} )

		assert.equal( electrode.connected, true )

		await wait( 1200 )
		const trace = await plant.listen( { seconds : 2 } )

		assert.ok( trace.features )
		assert.ok( Object.keys( trace.features ).length > 0 )

	} )

} )

describe( 'mqtt, against a real broker', () => {

	it( 'matches a topic filter rather than comparing it as a string', () => {

		// The bug this replaced: `topics: { temperature: 'home/+/temp' }`
		// subscribed successfully, received every message, and discarded all of
		// them, because the filter never equals the topic a message arrives on.
		assert.equal( topicMatches( 'home/+/temp', 'home/salon/temp' ), true )
		assert.equal( topicMatches( 'home/#', 'home/salon/temp' ), true )
		assert.equal( topicMatches( 'home/+/temp', 'home/salon/kitchen/temp' ), false )
		assert.equal( topicMatches( 'home/+/temp', 'home/temp' ), false )
		assert.equal( topicMatches( 'a/b', 'a/b' ), true )
		assert.equal( topicMatches( 'a/b', 'a/c' ), false )

	} )

	it( 'receives a message published before it subscribed', async () => {

		const broker = await startBroker()
		shut.push( () => broker.close() )

		// A device that reports on its own schedule and retains its state is the
		// normal case — ESPHome, Tasmota and Zigbee2MQTT all do it. The handler
		// used to be attached after subscribing, so the replay arrived first and
		// was dropped, and the driver reported that no message had ever come.
		broker.publish( 'plants/ivy/state', JSON.stringify( {
			temperature : 20.3,
			humidity : 62,
			soil : 41,
		} ) )

		const plant = await plantOn( 'Broker', {
			driver : 'mqtt',
			url : `mqtt://127.0.0.1:${broker.port}`,
			topic : 'plants/ivy/state',
		} )

		assert.equal( plant.sensors.peek( 'mqtt' ).connected, true )

		await wait( 300 )
		const r = await plant.read()

		assert.equal( r.temperature, 20.3 )
		assert.equal( r.soil, 41 )

	} )

	it( 'follows later publishes', async () => {

		const broker = await startBroker()
		shut.push( () => broker.close() )

		const plant = await plantOn( 'Live', {
			driver : 'mqtt',
			url : `mqtt://127.0.0.1:${broker.port}`,
			topic : 'plants/live',
		} )

		broker.publish( 'plants/live', JSON.stringify( { temperature : 24.8 } ) )
		await wait( 250 )

		assert.equal( ( await plant.read() ).temperature, 24.8 )

	} )

	it( 'handles one topic per metric, with wildcards', async () => {

		const broker = await startBroker()
		shut.push( () => broker.close() )

		const plant = await plantOn( 'Wild', {
			driver : 'mqtt',
			url : `mqtt://127.0.0.1:${broker.port}`,
			topics : {
				temperature : 'home/+/temp',
				humidity : 'home/+/hum',
			},
		} )

		broker.publish( 'home/salon/temp', '18.6' )
		broker.publish( 'home/salon/hum', '71' )
		await wait( 300 )

		const r = await plant.read()
		assert.equal( r.temperature, 18.6 )
		assert.equal( r.humidity, 71 )

	} )

	it( 'ignores a payload that is not a reading', async () => {

		const broker = await startBroker()
		shut.push( () => broker.close() )

		const plant = await plantOn( 'Junk', {
			driver : 'mqtt',
			url : `mqtt://127.0.0.1:${broker.port}`,
			topic : 'plants/junk',
		} )

		broker.publish( 'plants/junk', 'not json at all' )
		await wait( 200 )

		// Nothing usable arrived, and that is different from a reading of zero.
		await assert.rejects( () => plant.read(), /No MQTT messages/ )

		broker.publish( 'plants/junk', JSON.stringify( { temperature : 17.2 } ) )
		await wait( 250 )
		assert.equal( ( await plant.read() ).temperature, 17.2 )

	} )

} )

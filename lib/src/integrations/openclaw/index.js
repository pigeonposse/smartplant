/**
 * OpenClaw integration — the plant's brain.
 *
 * [OpenClaw](https://github.com/openclaw/openclaw) runs a local Gateway that
 * holds your models, keys and routing and speaks OpenAI-compatible HTTP. For
 * SmartPlant that is the third way to have AI:
 *
 *   cloud provider  → needs an API key
 *   Ollama          → needs a local model install
 *   **OpenClaw**    → **needs neither.** The Gateway you already run supplies
 *                     the model, the key and the embeddings.
 *
 * And because the Gateway does tool calling, OpenClaw can be more than a text
 * source: `OpenClawBrain` hands it the plant's entire control surface and lets
 * it *operate* the plant — read sensors, run a spectral sweep, diagnose, water,
 * move — with every acting call routed through SmartPlant's safety layers.
 *
 * Three ways in, smallest first:
 *
 * @example
 * // 1. Just the model. No API key, no Ollama.
 * plant.ai.registerProvider( 'openclaw', openclawProvider() )
 * plant.ai.use( 'openclaw' )
 *
 * @example
 * // 2. The brain. OpenClaw decides what to do and does it.
 * const brain = await plant.useBrain()
 * await brain.run( 'Check on the plant and fix anything that needs fixing.' )
 *
 * @example
 * // 3. The plant inside OpenClaw, reachable from any messaging channel.
 * //    smartplant openclaw ./my-plugin
 */

export {
	DEFAULT_GATEWAY_PORT, DEFAULT_GATEWAY_URL, OpenClawGateway,
	openclawEmbedder, openclawProvider,
} from './gateway.js'

export { OpenClawBrain } from './brain.js'

export {
	ACT_TOOLS, findTool, PLANT_TOOLS, READ_TOOLS, selectTools, TOOL_NAMES,
	toolSchemas,
} from './tools.js'

export { createToolHandlers, generatePlugin } from './plugin.js'

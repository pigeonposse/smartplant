/**
 * Migration — inheritance between individual plants.
 *
 * Federated learning pools statistics from many homes into an anonymous species
 * profile. This is the other shape of the same idea: a directed transfer from
 * one mature plant to one new one, rich and contextual, where the source is
 * known and the receiver keeps its own identity.
 *
 * ```js
 * import { exportBundle, importBundle } from 'smartplant/migration'
 *
 * const bundle = exportBundle( mature )
 * const { inheritance, compatibility } = importBundle( seedling, bundle )
 *
 * compatibility.verdict
 * inheritance.report()
 * ```
 *
 * The two rules that make it safe: only regularities that survived a change of
 * conditions are exportable, and the receiving plant's own measurements always
 * outrank what it inherited.
 */

export {
	compareConditions, exportBundle, MIN_SPAN, SCHEMA_VERSION, summarizeConditions,
} from './bundle.js'

export { importBundle, Inheritance } from './graft.js'

export {
	CONTEXT_BANDS, contextDiversity, contextSignature, evidenceWeight,
	recencyWeight, transferability,
} from './transferability.js'

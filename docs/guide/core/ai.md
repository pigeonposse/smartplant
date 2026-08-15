# AI

| Provider | Key | Notes |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | |
| OpenAI | `OPENAI_API_KEY` | |
| Claude | `ANTHROPIC_API_KEY` | |
| Grok | `XAI_API_KEY` | |
| **Ollama** | none | Runs entirely on your machine — nothing leaves it |
| **OpenClaw** | none | A local Gateway supplies the model, the key *and* the embeddings — see [OpenClaw](/guide/extra/openclaw) |
| **Mock** | none | Deterministic and offline, so the whole library is testable |

Retries with exponential backoff on transient failures, a response cache so ten plugins reacting to one sensor tick don't fire ten paid requests, and **structured output with schema coercion** — plugins receive objects with guaranteed keys, never prose to regex.

```js
const result = await plant.analyze( 'Does this plant need repotting?', {
  schema : { advice : '', urgency : 'low', potSizeCm : 0 },
} )
// result.advice, result.urgency and result.potSizeCm are always present
```

Register any other backend in three lines:

```js
plant.ai.registerProvider( 'my-llm', {
  generate : async ( { prompt, system } ) => callMyModel( system, prompt ),
} )
```

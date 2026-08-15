# Semantic memory

```js
await plant.remember( 'the radiator went on and the leaf tips browned' )

await plant.recall( 'the air is very dry' )
// [ { text: 'the radiator went on...', score: 0.71, at: '2026-01-14' } ]
```

A dependency-free hashing embedder and a flat index, so a plant on a Raspberry Pi has a memory without a vector database. Adapters for **Qdrant, Weaviate and Milvus** when the corpus outgrows it, and `ApiEmbedder` for a real embedding model.

**Every `analyze()` call is grounded with both layers**: the model receives the rule-derived findings and this plant's own precedents as premises, not just a snapshot. Disable per call with `{ ground : false }`, or the whole layer with `{ knowledge : false }`.

---

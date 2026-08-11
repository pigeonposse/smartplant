# @smartplant/stress

## 3.0.1

### Patch Changes

- Updated dependencies:
  - smartplant@3.0.1

## 3.0.0

### Major Changes

- Rewritten on the SmartPlant kernel. The 1.x plugin called `getSensor()`, `analyze()` and
  `registerPlugin()`, none of which existed, and was CJS against an ESM core — it could not
  run at all. It is now ESM, installs with `await plant.use( plugin )`, and has a passing
  test.

- Every AI call goes through the kernel's context pipeline, so the plugin receives a
  structured object with guaranteed keys rather than prose, and degrades to a deterministic
  offline result instead of throwing.

### Patch Changes

- Updated dependencies:
  - smartplant@3.0.0

## 1.0.1

### Patch Changes

- refactor repository

- Updated dependencies []:
  - smartplant@1.0.1

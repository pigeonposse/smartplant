# Vision

Three tiers behind one API. Use whichever you have.

| Tier | Needs | Gives |
| --- | --- | --- |
| **Classical** | nothing | Vegetation index, canopy geometry, wilting, chlorosis/necrosis, growth deltas |
| **ONNX** | `onnxruntime-node` | YOLO-family detection & segmentation on the edge, no Python at inference |
| **Python bridge** | Python + your toolkit | PlantCV, Ultralytics, detectron2, mmdetection |

```js
await plant.useVision( { source : { source : 'ffmpeg', input : '/dev/video0' } } )

const seen = await plant.see()

seen.description
// "canopy covers 12.4% of frame, visual health 78/100, 9% yellowing, canopy density 0.61"

seen.change.findings
// [ 'canopy shrank 8.2%', 'canopy has dropped — possible wilting' ]
```

**ffmpeg is the universal input**: V4L2 webcams including the PS3 Eye, AVFoundation on macOS, DirectShow on Windows, RTSP IP cameras, MJPEG streams, or a plain video file — emitted as raw `rgb24`, so no image decoder is needed on our side and no native dependency enters the install.

The classical tier is deliberately first. A neural detector tells you *"leaf, 0.94"*. A vegetation index tells you the canopy lost 8% since Tuesday, and you can check the arithmetic. It measures Excess Green segmentation (brightness-invariant, so it tracks the plant and not the room lights), bounding box, centroid, density, aspect ratio, and the **vertical centroid** whose rise is wilting.

```js
import { PythonBridge } from 'smartplant/vision'

const bridge = new PythonBridge()
await bridge.ping()                          // which backends are installed
await bridge.plantcv( frame )                // skeleton, leaf count, convex hull, solidity
await bridge.yolo( frame, { model : 'yolov8n.pt' } )
await bridge.run( frame, myPythonScript )    // detectron2, custom torch, anything
```

One long-lived Python process, JSON over stdio — loading a YOLO model costs seconds, and per-call spawning would make continuous monitoring unusable.

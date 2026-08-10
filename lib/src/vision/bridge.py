#!/usr/bin/env python3
"""
SmartPlant Python bridge.

Speaks newline-delimited JSON on stdin/stdout so the Node kernel can reach the
Python computer-vision ecosystem — PlantCV, Ultralytics/YOLO, detectron2,
mmdetection, segmentation_models.pytorch — without any of it becoming a
dependency of the library.

Every backend is imported lazily inside its handler: a user who only wants
PlantCV never needs torch installed, and a missing package produces a clear
JSON error instead of a stack trace on startup.

Protocol
--------
    -> {"id": 1, "op": "ping"}
    <- {"id": 1, "ok": true, "result": {...}}
    <- {"id": 1, "ok": false, "error": "...", "hint": "pip install ..."}

Run it yourself to check an install:
    python3 bridge.py --selftest
"""

import base64
import json
import sys
import traceback


def _decode_frame(payload):
    """Turn the wire frame into a numpy array (H, W, 3) uint8."""
    import numpy as np

    width = payload["width"]
    height = payload["height"]
    channels = payload.get("channels", 3)
    raw = base64.b64decode(payload["data"])

    arr = np.frombuffer(raw, dtype=np.uint8)
    arr = arr[: width * height * channels].reshape((height, width, channels))
    return arr[:, :, :3].copy()


def op_ping(_payload):
    """Report which backends are actually importable in this interpreter."""
    available = {}
    for name, module in (
        ("plantcv", "plantcv"),
        ("ultralytics", "ultralytics"),
        ("detectron2", "detectron2"),
        ("mmdet", "mmdet"),
        ("mmseg", "mmseg"),
        ("segmentation_models_pytorch", "segmentation_models_pytorch"),
        ("torch", "torch"),
        ("cv2", "cv2"),
        ("numpy", "numpy"),
    ):
        try:
            __import__(module)
            available[name] = True
        except Exception:
            available[name] = False

    return {"python": sys.version.split()[0], "backends": available}


def op_plantcv(payload):
    """
    PlantCV phenotyping.

    Returns the shape descriptors PlantCV is actually good at and that the pure
    JS analysis cannot compute: skeleton, leaf count, convex hull, solidity.
    """
    from plantcv import plantcv as pcv
    import numpy as np

    img = _decode_frame(payload["frame"])

    pcv.params.debug = None

    # Excess-green threshold, matching the JS segmentation so results are
    # comparable across the two implementations.
    index = pcv.spectral_index.exg(rgb_img=img)
    mask = pcv.threshold.binary(
        gray_img=index.array_data.astype(np.uint8),
        threshold=payload.get("threshold", 20),
        object_type="light",
    )
    mask = pcv.fill(bin_img=mask, size=payload.get("min_object_size", 50))

    result = {"plant_pixels": int(np.count_nonzero(mask))}

    try:
        shape = pcv.analyze.size(img=img, labeled_mask=mask)
        result["observations"] = _clean(pcv.outputs.observations)
        del shape
    except Exception as err:  # analysis is best-effort; the mask is the point
        result["shape_error"] = str(err)

    try:
        skeleton = pcv.morphology.skeletonize(mask=mask)
        _, leaf_objects = pcv.morphology.segment_skeleton(skel_img=skeleton)
        result["leaf_count"] = len(leaf_objects)
    except Exception as err:
        result["skeleton_error"] = str(err)

    return result


def op_yolo(payload):
    """Ultralytics YOLO detection or segmentation."""
    from ultralytics import YOLO

    model_path = payload.get("model", "yolov8n.pt")
    model = YOLO(model_path)

    img = _decode_frame(payload["frame"])
    results = model.predict(
        source=img,
        conf=payload.get("confidence", 0.25),
        verbose=False,
    )

    detections = []
    for r in results:
        names = r.names
        if r.boxes is None:
            continue
        for box in r.boxes:
            detections.append(
                {
                    "label": names.get(int(box.cls[0]), str(int(box.cls[0]))),
                    "confidence": round(float(box.conf[0]), 4),
                    "box": [round(float(v), 2) for v in box.xyxy[0].tolist()],
                }
            )

    return {"model": model_path, "detections": detections}


def op_mmdet(payload):
    """OpenMMLab mmdetection inference."""
    from mmdet.apis import inference_detector, init_detector

    model = init_detector(
        payload["config"],
        payload["checkpoint"],
        device=payload.get("device", "cpu"),
    )
    img = _decode_frame(payload["frame"])
    result = inference_detector(model, img)

    instances = result.pred_instances
    keep = instances.scores > payload.get("confidence", 0.3)

    return {
        "detections": [
            {
                "label": int(label),
                "confidence": round(float(score), 4),
                "box": [round(float(v), 2) for v in box],
            }
            for label, score, box in zip(
                instances.labels[keep].tolist(),
                instances.scores[keep].tolist(),
                instances.bboxes[keep].tolist(),
            )
        ]
    }


def op_eval(payload):
    """
    Run an arbitrary user-supplied script against the frame.

    The escape hatch for anything not covered above — detectron2, a custom
    torch model, a research notebook turned into a function. The script gets
    `frame` (numpy array) and must set `result` to something JSON-serializable.

    This executes code the caller passed in. It is only ever reachable from the
    local process that spawned this bridge, never from a frame or a model.
    """
    scope = {"frame": _decode_frame(payload["frame"]), "result": None}
    exec(payload["script"], scope)  # noqa: S102 — documented, local-only escape hatch
    return scope["result"]


def _clean(obj):
    """Make PlantCV observations JSON-serializable."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            return str(obj)
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


HINTS = {
    "plantcv": "pip install plantcv",
    "ultralytics": "pip install ultralytics",
    "mmdet": "pip install openmim && mim install mmdet",
    "numpy": "pip install numpy",
    "cv2": "pip install opencv-python",
    "torch": "pip install torch",
}

OPS = {
    "ping": op_ping,
    "plantcv": op_plantcv,
    "yolo": op_yolo,
    "mmdet": op_mmdet,
    "eval": op_eval,
}


def _hint_for(err):
    text = str(err)
    for module, hint in HINTS.items():
        if module in text:
            return hint
    return None


def main():
    if "--selftest" in sys.argv:
        print(json.dumps(op_ping({}), indent=2))
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as err:
            sys.stdout.write(json.dumps({"id": None, "ok": False, "error": f"bad JSON: {err}"}) + "\n")
            sys.stdout.flush()
            continue

        req_id = request.get("id")
        op = request.get("op")

        try:
            handler = OPS.get(op)
            if handler is None:
                raise ValueError(f"unknown op '{op}'. Known: {', '.join(OPS)}")
            response = {"id": req_id, "ok": True, "result": handler(request)}
        except Exception as err:  # noqa: BLE001 — every failure must reach Node as JSON
            response = {
                "id": req_id,
                "ok": False,
                "error": str(err),
                "hint": _hint_for(err),
                "traceback": traceback.format_exc()[-1500:],
            }

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

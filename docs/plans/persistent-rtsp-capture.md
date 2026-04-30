# Plan: Persistent RTSP Capture + Per-Camera Watchdog

**Status:** Pending implementation
**Priority:** Medium-high — fixes both CAM 4-style stalls AND the 10× detection-latency gap
**Effort:** ~150 lines of code change across 1 file (`face_recognizer.py`), with smaller adjustments in `face_recognition_service.py`

---

## Problem statement

Two related issues observed today:

1. **Detection latency is ~54 sec, not the configured 5 sec.**
   Each capture iteration opens a fresh RTSP TCP/H.264 connection, grabs one frame, closes. With 16 cameras hitting one Dahua NVR, the per-iteration overhead (TCP handshake + RTSP SETUP/PLAY + H.264 SPS/PPS warmup + buffer flush) dominates the loop, dwarfing the 5-second `sleep`.

2. **Silent stalls (CAM 4 stuck for 16+ minutes today).**
   When `cv2.VideoCapture` hangs inside ffmpeg (DNS, dropped packets, NVR throttle), the OPEN/READ_TIMEOUT hints aren't always honored. The thread is alive but produces no new frames; the snapshot loop reuses the stale cached frame indefinitely; the dashboard shows a frozen image with no obvious error.

Both have the same root cause: open-close-per-iteration isn't a great pattern for long-running CCTV. The fix is **persistent connections** + a **liveness watchdog**.

---

## Approach

Adopt the same pattern that already works for enrollment in
`face_recognition_service.py:_manual_reader_open_and_loop` — open the RTSP
stream once, keep a tight reader loop running, drain frames continuously, and
expose only the "latest frame" to the analysis side.

Per camera there will be **two threads** (instead of one):

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Reader thread           │        │  Analyser thread         │
│  (one-time RTSP open)    │        │  (existing _camera_loop) │
│                          │        │                          │
│  while not stop:         │        │  while not stop:         │
│      ret, f = cap.read() │ ─────> │      f = latest_frame    │
│      latest_frame = f    │  share │      run YOLO+InsightFace│
│      last_read_ts = now()│        │      sleep(interval)     │
│      if EOF: reopen      │        │                          │
└──────────────────────────┘        └──────────────────────────┘
                                                   │
                                                   ▼
                                       ┌──────────────────────────┐
                                       │  Watchdog thread (single)│
                                       │                          │
                                       │  every 30s:              │
                                       │     for each cam:        │
                                       │        if last_read >60s │
                                       │           kill reader    │
                                       │           respawn reader │
                                       └──────────────────────────┘
```

### Why two threads, not one
The reader needs to drain frames as fast as the network delivers them
(continuously, ~25 fps) so the H.264 decoder doesn't fall behind and trigger
internal buffer overflow / decoder reset. The analyser only needs a frame every
few seconds. Coupling them means the analyser's processing time blocks the
decoder. Decoupling lets the reader run hot.

---

## Implementation

### 1. New `RTSPReader` helper class
**File:** `backend/app/lib/face_recognizer.py` (new class near top, after `capture_frame`)

```python
class RTSPReader:
    """Persistent RTSP reader. Opens once, drains continuously, exposes latest frame."""

    def __init__(self, rtsp_url: str, camera_name: str):
        self.rtsp_url = rtsp_url
        self.camera_name = camera_name
        self._cap = None
        self._latest_frame = None
        self._last_read_ts = 0.0  # epoch seconds
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(
            target=self._loop,
            daemon=True,
            name=f"rtsp-reader-{self.camera_name}",
        )
        self._thread.start()

    def stop(self, timeout=5.0):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None

    def get_latest_frame(self):
        with self._lock:
            return None if self._latest_frame is None else self._latest_frame.copy()

    def get_age_seconds(self) -> float:
        with self._lock:
            return float('inf') if self._last_read_ts == 0 else time.time() - self._last_read_ts

    def _open(self) -> bool:
        if self._cap is not None:
            try: self._cap.release()
            except: pass
        self._cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        self._cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        self._cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # always read newest frame
        return self._cap.isOpened()

    def _loop(self):
        backoff = 1.0
        while not self._stop_event.is_set():
            if self._cap is None or not self._cap.isOpened():
                if not self._open():
                    logger.warning("[%s] RTSP open failed, retrying in %.1fs",
                                   self.camera_name, backoff)
                    self._stop_event.wait(backoff)
                    backoff = min(backoff * 2, 30)
                    continue
                backoff = 1.0
                logger.info("[%s] RTSP connected", self.camera_name)

            try:
                ret, frame = self._cap.read()
            except Exception as e:
                logger.warning("[%s] read exception: %s", self.camera_name, e)
                ret, frame = False, None

            if not ret or frame is None:
                logger.warning("[%s] read failed (EOF or stream drop), reopening",
                               self.camera_name)
                try: self._cap.release()
                except: pass
                self._cap = None
                continue

            with self._lock:
                self._latest_frame = frame
                self._last_read_ts = time.time()
```

**Key properties:**
- One persistent `cv2.VideoCapture` per camera, kept open for the lifetime of the thread
- `BUFFERSIZE=1` ensures we always read the most recent frame, never a stale buffered one
- On EOF / read failure, `_cap` is dropped and the next iteration reopens with exponential backoff (1s → 2s → 4s → ... up to 30s)
- `get_age_seconds()` exposes the liveness signal for the watchdog

### 2. Refactor `_camera_loop` to consume from RTSPReader
**File:** `face_recognizer.py:1786`

Replace:
```python
def _camera_loop(self, cam_cfg):
    ...
    while not self._stop_event.is_set():
        frame = capture_frame(camera_url, camera_name)   # ← old: per-iter open/close
        if frame is None: ...
        ...
```

With:
```python
def _camera_loop(self, cam_cfg):
    camera_name = cam_cfg['name']
    camera_url = cam_cfg['url']

    # Spawn persistent reader for this camera
    reader = RTSPReader(camera_url, camera_name)
    reader.start()
    self._readers[camera_name] = reader

    while not self._stop_event.is_set():
        # Pull latest frame from persistent reader
        frame = reader.get_latest_frame()
        if frame is None or reader.get_age_seconds() > 30:
            # No fresh frame yet — wait briefly and retry
            self._stop_event.wait(1)
            continue

        capture_count += 1
        ... (existing batch-build + analyse logic, unchanged)

        self._stop_event.wait(self._capture_interval)
```

Add `self._readers: dict[str, RTSPReader] = {}` to `__init__`.
Update `stop()` to call `reader.stop()` for each.

### 3. Watchdog thread
**File:** `face_recognition_service.py` — add new method, spawn alongside snapshot thread

```python
@classmethod
def _watchdog_loop(cls):
    """Detect stalled RTSP readers and force a reconnect."""
    logger.info('Watchdog loop active')
    STALE_THRESHOLD = 60      # seconds
    CHECK_INTERVAL = 30       # seconds

    while cls._running:
        try:
            with cls._lock:
                instance = cls._instance
            if instance is None:
                time.sleep(CHECK_INTERVAL)
                continue

            for cam_name in list(instance._readers.keys()):
                reader = instance._readers.get(cam_name)
                if reader is None:
                    continue
                age = reader.get_age_seconds()
                if age > STALE_THRESHOLD:
                    logger.warning(
                        "[watchdog] %s stale for %.0fs — forcing reconnect",
                        cam_name, age)
                    # The reader's loop will reopen on next iteration once we
                    # drop the cap. Easiest: stop+start the whole reader.
                    reader.stop(timeout=2)
                    new_reader = RTSPReader(reader.rtsp_url, cam_name)
                    new_reader.start()
                    instance._readers[cam_name] = new_reader

                    # Push SSE so the UI can show a momentary "reconnecting" state
                    from ..api.sse import push_event
                    push_event({
                        'type': 'camera_reconnect',
                        'camera_name': cam_name,
                        'stale_seconds': round(age, 1),
                    })
        except Exception:
            logger.exception("Watchdog error")

        time.sleep(CHECK_INTERVAL)
```

Spawn it in `start()` next to the snapshot thread:
```python
cls._watchdog_thread = threading.Thread(
    target=cls._watchdog_loop, daemon=True, name='watchdog')
cls._watchdog_thread.start()
```

### 4. Frontend: handle `camera_reconnect` SSE event (optional, polish)
**File:** `frontend/src/app/cctv/page.tsx`

Add handler for the new event type to briefly grey out the affected camera tile and show a "Reconnecting..." overlay until the next snapshot lands.

```ts
if (event.type === 'camera_reconnect') {
  setReconnectingCams(prev => new Set([...prev, event.camera_name]))
  setTimeout(() => {
    setReconnectingCams(prev => {
      const n = new Set(prev); n.delete(event.camera_name); return n
    })
  }, 8000)
}
```

---

## Trade-offs

| Aspect | Before | After |
|---|---|---|
| Detection latency | ~54s | ~5-7s (matches config) |
| NVR connection count | 16 cameras × open/close every iteration → ~3 conn/sec churn | 16 long-lived connections, no churn |
| CPU | Currently 15%; expected similar (decode runs in ffmpeg thread anyway) | Similar |
| RAM | One frame per camera cached | Same — already had `_latest_frames` cache |
| Bandwidth | Same total (still pulling H.264 stream) | Same |
| Failure mode | Silent stall, no recovery | Detected within 60s, auto-reconnect |
| Code complexity | One thread/cam | Two threads/cam + 1 watchdog |

**Net:** more threads (16 readers + 16 analysers + 1 watchdog + 1 snapshot = 34, up from 17) but each reader is much simpler and most are blocked on socket I/O so they don't consume CPU. The trade is well worth it.

---

## Testing checklist

1. Start backend, watch logs for `[CAM N] RTSP connected` from each camera
2. Capture log lines should now appear at ~5s intervals (matching `_capture_interval`), not ~54s
3. Walk past a camera — detection event should fire within ~5-7s, not ~50s
4. **Force-stall test:** unplug one camera's network cable. Within 60s the watchdog should log `[watchdog] CAM N stale for ... — forcing reconnect`. Plug back in. Reader should reconnect and resume.
5. Restart NVR or the entire network. All readers should reconnect with exponential backoff and resume.
6. CCTV grid in browser should never show a frozen image for >60s; reconnecting cameras get the (optional) overlay.

---

## Files to modify

1. `backend/app/lib/face_recognizer.py`
   - Add `class RTSPReader` (~80 lines)
   - Refactor `_camera_loop` to use it (~30 line change)
   - Add `self._readers` dict to `__init__`
   - Update `stop()` to clean up readers
2. `backend/app/services/face_recognition_service.py`
   - Add `_watchdog_loop` classmethod (~40 lines)
   - Spawn watchdog thread in `start()` (~5 lines)
3. `frontend/src/app/cctv/page.tsx` (optional polish)
   - Handle `camera_reconnect` SSE event
4. `frontend/src/lib/types.ts` (optional)
   - Add `'camera_reconnect'` to SSE event type union

---

## Out of scope (defer)

- **Adaptive capture rate** based on motion: only run YOLO+InsightFace if there's actual motion in the frame. Could 5-10× reduce CPU when a room is empty.
- **GPU acceleration** for InsightFace: move from CPU to CUDA. Bigger refactor, hardware-dependent.
- **Move snapshot blobs out of DB to filesystem**: separate plan, see "Snapshot DB bloat" todo.

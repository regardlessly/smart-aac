#!/usr/bin/env python3
"""
Face Recognition System for RTSP Cameras (AI-Based, Self-Learning)

Two-stage detection pipeline:
  Stage 1: YOLOv8 person detection on full CCTV frame
  Stage 2: SCRFD face detection on each person crop

Uses InsightFace (buffalo_l model pack):
  - SCRFD-10GF for face detection (on person crops)
  - ArcFace (ResNet50, trained on WebFace600K) for 512-d face embeddings

Flow:
  1. Capture a frame every 30 seconds (configurable)
  2. Every 5 captures (configurable), analyse the batch:
     - Detect persons with YOLOv8
     - Crop each person, then detect faces with SCRFD
     - Extract 512-d embeddings with ArcFace
     - Compare against known face embeddings (cosine similarity)
     - Auto-learn: save high-confidence CCTV crops as training data
  3. On exit (Ctrl+C), print a summary report with cropped faces
"""

import cv2
import numpy as np
from datetime import datetime
import time
import json
import os
import re
import threading
import base64
import logging
import shutil
import tempfile

from insightface.app import FaceAnalysis

logger = logging.getLogger("face_recognizer")


# ── Person Detector (YOLO Stage 1) ───────────────────────────────────────────

class PersonDetector:
    """
    YOLOv8 person detection for CCTV frames.
    Detects person bounding boxes that are then cropped for face detection.
    """

    def __init__(self, model_path, imgsz=1280, person_conf=0.30,
                 crop_padding=0.3, min_person_height=80):
        from ultralytics import YOLO
        self.model = YOLO(model_path)
        self.imgsz = imgsz
        self.person_conf = person_conf
        self.crop_padding = crop_padding
        self.min_person_height = min_person_height
        logger.info("  YOLO model:  %s", model_path)
        logger.info("  YOLO imgsz:  %s", imgsz)
        logger.info("  Person conf: %s", person_conf)
        logger.info("  Min height:  %spx", min_person_height)

    def detect_persons(self, frame):
        """
        Detect persons in a CCTV frame.

        Returns:
            List of dicts with keys: x1, y1, x2, y2, conf, crop, crop_offset
            where crop is the padded person region from the full-res frame.
        """
        results = self.model(frame, classes=[0], conf=self.person_conf,
                             imgsz=self.imgsz, verbose=False)
        persons = []
        fh, fw = frame.shape[:2]

        for r in results:
            for box in r.boxes:
                bx1, by1, bx2, by2 = box.xyxy[0].cpu().numpy().astype(int)
                conf = float(box.conf[0])
                bw, bh = bx2 - bx1, by2 - by1

                # Skip small detections (likely false positives)
                if bh < self.min_person_height:
                    continue

                # Add padding to person crop
                pad = int(max(bw, bh) * self.crop_padding)
                cx1 = max(0, bx1 - pad)
                cy1 = max(0, by1 - pad)
                cx2 = min(fw, bx2 + pad)
                cy2 = min(fh, by2 + pad)
                crop = frame[cy1:cy2, cx1:cx2]

                if crop.size == 0:
                    continue

                persons.append({
                    'x1': bx1, 'y1': by1, 'x2': bx2, 'y2': by2,
                    'conf': conf,
                    'crop': crop,
                    'crop_offset': (cx1, cy1),
                })
        return persons


# ── Face Recognition Engine ────────────────────────────────────────────────────

class FaceRecognitionEngine:
    """
    Two-stage face recognition:
      Stage 1: YOLOv8 person detection on full CCTV frame
      Stage 2: SCRFD face detection + ArcFace recognition on person crops
    """

    def __init__(self, known_faces_dir, confidence_threshold=0.20,
                 det_size=(640, 640), yolo_config=None):
        """
        Args:
            known_faces_dir: Directory with known face images
            confidence_threshold: Cosine similarity threshold for recognition
            det_size: SCRFD detection input size (for person crops)
            yolo_config: Dict with YOLO settings (model_path, imgsz, etc.)
        """
        self.known_faces_dir = known_faces_dir
        self.confidence_threshold = confidence_threshold
        self.det_size = det_size
        self.known_embeddings = []  # list of (name, embedding_numpy)
        self._last_persons = []     # last YOLO detections (for annotation)

        logger.info("Loading two-stage detection pipeline...")

        # Stage 1: YOLO person detector
        if yolo_config:
            logger.info("\n[Stage 1] YOLOv8 Person Detector:")
            self.person_detector = PersonDetector(
                model_path=yolo_config['model_path'],
                imgsz=yolo_config.get('imgsz', 1280),
                person_conf=yolo_config.get('person_conf', 0.30),
                crop_padding=yolo_config.get('crop_padding', 0.3),
                min_person_height=yolo_config.get('min_person_height', 80),
            )
        else:
            self.person_detector = None
            logger.info("  YOLO: disabled (single-stage SCRFD only)")

        # Stage 2: InsightFace (SCRFD + ArcFace)
        logger.info("\n[Stage 2] InsightFace (buffalo_l):")
        logger.info("  Detection:   SCRFD-10GF")
        logger.info("  Recognition: ArcFace ResNet50 (WebFace600K, 512-d)")

        # Dedicated loader instance for known faces (close-up selfies).
        # Re-calling prepare() on the same FaceAnalysis instance does NOT
        # reliably change det_size, so we use separate instances.
        logger.info("  Loading LOADER instance (det_size=640x640)...")
        self._loader_app = FaceAnalysis(name='buffalo_l',
                                        providers=['CPUExecutionProvider'])
        self._loader_app.prepare(ctx_id=-1, det_size=(640, 640))

        # CCTV instance for person crops at runtime
        logger.info(f"  Loading CCTV instance (det_size={det_size[0]}x{det_size[1]})...")
        self.app = FaceAnalysis(name='buffalo_l',
                                providers=['CPUExecutionProvider'])
        self.app.prepare(ctx_id=-1, det_size=det_size)

        # Load known faces
        self._load_known_faces()

    def _load_known_faces(self):
        """Load known face images and extract embeddings using the loader instance."""
        self.known_embeddings = []

        if not os.path.isdir(self.known_faces_dir):
            logger.warning(f"Warning: known_faces directory not found: {self.known_faces_dir}")
            os.makedirs(self.known_faces_dir, exist_ok=True)
            return

        supported = ('.jpg', '.jpeg', '.png')
        person_counts = {}

        for filename in sorted(os.listdir(self.known_faces_dir)):
            if not filename.lower().endswith(supported):
                continue

            filepath = os.path.join(self.known_faces_dir, filename)
            name = get_person_name(filename)

            image_bgr = cv2.imread(filepath)
            if image_bgr is None:
                continue

            # Always use the loader instance — it handles close-up selfies
            # reliably at (640,640) where SCRFD's anchors can match the face.
            faces = self._loader_app.get(image_bgr)

            if not faces:
                logger.debug(f"  Skipped: {filename} (no face detected)")
                continue

            # Use the face with highest detection score
            best_face = max(faces, key=lambda f: f.det_score)
            embedding = best_face.normed_embedding

            self.known_embeddings.append((name, embedding))
            person_counts[name] = person_counts.get(name, 0) + 1
            logger.info(f"  Loaded: {filename} -> '{name}' (det={best_face.det_score:.3f})")

        if not self.known_embeddings:
            logger.info("No known faces loaded. All faces will be reported as strangers.")
        else:
            for person, count in person_counts.items():
                logger.info(f"  {person}: {count} embedding(s)")

    def analyze_frame(self, frame):
        """
        Two-stage face detection and recognition:
          Stage 1: YOLO person detection on full frame
          Stage 2: SCRFD face detection on each person crop

        Falls back to direct SCRFD if no YOLO detector configured.

        Returns:
            List of face result dicts
        """
        self._last_persons = []

        if self.person_detector is None:
            return self._analyze_frame_direct(frame)

        # Stage 1: Detect persons with YOLO
        persons = self.person_detector.detect_persons(frame)
        self._last_persons = persons

        if not persons:
            return []

        face_results = []

        # Stage 2: For each person, detect faces in the crop
        for person in persons:
            crop = person['crop']
            offset_x, offset_y = person['crop_offset']

            try:
                faces = self.app.get(crop)
            except Exception as e:
                logger.error(f"  SCRFD error on person crop: {e}")
                continue

            for face in faces:
                bbox = face.bbox.astype(int)
                fx1, fy1, fx2, fy2 = bbox

                # Map coordinates back to full frame
                fx1_full = fx1 + offset_x
                fy1_full = fy1 + offset_y
                fx2_full = fx2 + offset_x
                fy2_full = fy2 + offset_y

                w = fx2_full - fx1_full
                h = fy2_full - fy1_full
                det_conf = float(face.det_score)
                embedding = face.normed_embedding

                # Filter very small faces
                if w < 15 or h < 15:
                    continue

                # Compare against known faces — use best similarity per person
                name = "Stranger"
                best_score = 0.0

                person_best = {}
                for known_name, known_emb in self.known_embeddings:
                    sim = float(np.dot(known_emb, embedding))
                    if known_name not in person_best or sim > person_best[known_name]:
                        person_best[known_name] = sim

                for pname, psim in person_best.items():
                    if psim > best_score:
                        best_score = psim
                        if psim >= self.confidence_threshold:
                            name = pname

                face_results.append({
                    'x': fx1_full, 'y': fy1_full, 'w': w, 'h': h,
                    'name': name, 'score': best_score,
                    'embedding': embedding,
                    'det_score': det_conf,
                    'person_conf': person['conf'],
                })

        # Deduplicate overlapping faces from padded person crops.
        # When people are close together, padded crops overlap and
        # the same face can be detected in multiple crops.
        face_results = self._deduplicate_faces(face_results)

        return face_results

    @staticmethod
    def _deduplicate_faces(face_results, iou_threshold=0.3):
        """
        Remove duplicate face detections in two stages:
          1. IoU-based: overlapping bounding boxes from padded person crops
          2. Identity-based: same known person detected in multiple locations
             (a real person can only be in one place at a time)

        Keeps the detection with higher det_score (IoU) or higher similarity
        score (identity).
        """
        if len(face_results) <= 1:
            return face_results

        # ── Stage 1: IoU-based deduplication ──────────────────────
        # Sort by det_score descending — keep higher confidence first
        sorted_faces = sorted(face_results, key=lambda r: r['det_score'],
                              reverse=True)
        keep = []

        for face in sorted_faces:
            is_duplicate = False
            fx1 = face['x']
            fy1 = face['y']
            fx2 = fx1 + face['w']
            fy2 = fy1 + face['h']
            face_area = face['w'] * face['h']

            for kept in keep:
                kx1 = kept['x']
                ky1 = kept['y']
                kx2 = kx1 + kept['w']
                ky2 = ky1 + kept['h']
                kept_area = kept['w'] * kept['h']

                # Calculate IoU (intersection over union)
                ix1 = max(fx1, kx1)
                iy1 = max(fy1, ky1)
                ix2 = min(fx2, kx2)
                iy2 = min(fy2, ky2)

                if ix1 < ix2 and iy1 < iy2:
                    intersection = (ix2 - ix1) * (iy2 - iy1)
                    union = face_area + kept_area - intersection
                    iou = intersection / union if union > 0 else 0

                    if iou >= iou_threshold:
                        is_duplicate = True
                        break

            if not is_duplicate:
                keep.append(face)

        # ── Stage 2: Identity-based deduplication ─────────────────
        # A known person can only be in one place at a time.
        # If "Khant Zaw Win" is detected at two different locations,
        # keep the detection with the higher similarity score and
        # demote the weaker one to "Stranger" (it might be a real
        # different person matched at the low threshold).
        identity_best = {}  # name -> index in keep list
        demote_indices = set()  # indices to demote to Stranger

        for i, face in enumerate(keep):
            name = face['name']
            if name == "Stranger":
                continue
            if name not in identity_best:
                identity_best[name] = i
            else:
                existing_idx = identity_best[name]
                # Keep the detection with higher similarity score
                if face['score'] > keep[existing_idx]['score']:
                    demote_indices.add(existing_idx)
                    identity_best[name] = i
                else:
                    demote_indices.add(i)

        # Demote weaker duplicates to Stranger
        for i in demote_indices:
            keep[i]['name'] = "Stranger"
            keep[i]['score'] = 0.0

        return keep

    def _analyze_frame_direct(self, frame):
        """Original single-stage SCRFD analysis (fallback when YOLO disabled)."""
        try:
            faces = self.app.get(frame)
        except Exception as e:
            logger.error(f"  Detection error: {e}")
            return []

        if not faces:
            return []

        face_results = []

        for face in faces:
            bbox = face.bbox.astype(int)
            x1, y1, x2, y2 = bbox
            w = x2 - x1
            h = y2 - y1
            det_conf = float(face.det_score)
            embedding = face.normed_embedding

            if w < 20 or h < 20:
                continue

            name = "Stranger"
            best_score = 0.0

            person_best = {}
            for known_name, known_emb in self.known_embeddings:
                sim = float(np.dot(known_emb, embedding))
                if known_name not in person_best or sim > person_best[known_name]:
                    person_best[known_name] = sim

            for pname, psim in person_best.items():
                if psim > best_score:
                    best_score = psim
                    if psim >= self.confidence_threshold:
                        name = pname

            face_results.append({
                'x': x1, 'y': y1, 'w': w, 'h': h,
                'name': name, 'score': best_score,
                'embedding': embedding,
                'det_score': det_conf,
                'person_conf': None,
            })

        return face_results

    def add_embedding(self, name, embedding):
        """Add a new embedding to the known faces (auto-learn)."""
        self.known_embeddings.append((name, embedding))

    def is_diverse_embedding(self, new_emb, name, diversity_threshold=0.60):
        """Check if new embedding is diverse enough from existing ones."""
        person_embeddings = [(n, e) for n, e in self.known_embeddings if n == name]
        for _, emb in person_embeddings:
            sim = float(np.dot(new_emb, emb))
            if sim > diversity_threshold:
                return False
        return True

    def get_person_embedding_count(self, name):
        """Count embeddings for a specific person."""
        return sum(1 for n, _ in self.known_embeddings if n == name)


# ── Utility Functions ──────────────────────────────────────────────────────────

def get_person_name(filename):
    """Extract person name from filename."""
    base = os.path.splitext(filename)[0]
    parts = base.split('_')

    descriptors = {'front', 'side', 'left', 'right', 'profile', 'up', 'down',
                   'close', 'far', 'cctv', 'cam', 'camera', 'night', 'day',
                   'auto', 'learn', 'learned'}
    while len(parts) > 1:
        last = parts[-1].lower()
        stripped = re.sub(r'\d+$', '', last)
        if last.isdigit() or last in descriptors or stripped in descriptors:
            parts = parts[:-1]
        else:
            break

    return ' '.join(parts)


def capture_frame(rtsp_url, camera_name='Camera'):
    """Connect to RTSP stream, grab a single frame, then disconnect."""
    cap = None
    try:
        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            logger.error(f"[{camera_name}] Failed to connect to stream")
            return None
        for _ in range(5):
            cap.grab()
        ret, frame = cap.read()
        if not ret or frame is None:
            logger.error(f"[{camera_name}] Failed to read frame")
            return None
        return frame
    except Exception as e:
        logger.error(f"[{camera_name}] Capture error: {e}")
        return None
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


def annotate_frame(frame, face_results, camera_name='Camera',
                   person_boxes=None):
    """Draw person boxes, face boxes, and labels on a frame."""
    annotated = frame.copy()

    # Draw YOLO person boxes (thin cyan)
    if person_boxes:
        for p in person_boxes:
            cv2.rectangle(annotated,
                          (p['x1'], p['y1']), (p['x2'], p['y2']),
                          (255, 200, 0), 1)

    # Draw face boxes
    for r in face_results:
        x, y, w, h = r['x'], r['y'], r['w'], r['h']
        name, score = r['name'], r['score']

        color = (0, 0, 255) if name.startswith("Stranger") else (0, 255, 0)
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)

        label = f"{name} ({score:.2f})"
        label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)[0]
        cv2.rectangle(annotated,
                      (x, y - label_size[1] - 10),
                      (x + label_size[0] + 10, y),
                      color, cv2.FILLED)
        cv2.putText(annotated, label, (x + 5, y - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

    # Pipeline info overlay
    pipeline = "YOLO+SCRFD" if person_boxes is not None else "SCRFD"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cv2.putText(annotated, f"{camera_name} | {timestamp} | {pipeline}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 200, 0), 2)

    persons_text = f"Persons: {len(person_boxes)}" if person_boxes else ""
    face_count_text = f"Faces: {len(face_results)}"
    cv2.putText(annotated, f"{persons_text}  {face_count_text}", (10, 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    has_stranger = any(r['name'].startswith("Stranger") for r in face_results)
    if has_stranger:
        cv2.putText(annotated, "STRANGER DETECTED", (10, 95),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

    return annotated


def auto_learn_face(frame, face_result, known_faces_dir, engine,
                    max_per_person=15, auto_learn_threshold=0.35):
    """
    Save a high-confidence CCTV face crop as training data.
    Only saves if the similarity score is well above the recognition threshold
    AND the embedding is diverse enough.
    """
    name = face_result['name']
    score = face_result['score']
    embedding = face_result['embedding']

    # Only auto-learn if similarity is well above recognition threshold
    if score < auto_learn_threshold:
        return None

    # Cap max embeddings per person
    count = engine.get_person_embedding_count(name)
    if count >= max_per_person + 1:
        return None

    if not engine.is_diverse_embedding(embedding, name, diversity_threshold=0.60):
        return None

    # Crop face with padding
    x, y, w, h = face_result['x'], face_result['y'], face_result['w'], face_result['h']
    fh_full, fw_full = frame.shape[:2]
    pad = int(max(w, h) * 0.3)
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(fw_full, x + w + pad)
    y2 = min(fh_full, y + h + pad)
    crop = frame[y1:y2, x1:x2]

    if crop.size == 0:
        return None

    safe_name = name.replace(' ', '_')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    filename = f"{safe_name}_auto_{timestamp}.jpg"
    filepath = os.path.join(known_faces_dir, filename)
    cv2.imwrite(filepath, crop)

    logger.info(f"    [Auto-Learn] Saved {filename} ({w}x{h}px, sim={face_result['score']:.3f})")
    engine.add_embedding(name, embedding)
    return (name, embedding)


def crop_face(frame, face_result, padding=0.4):
    """Crop a face region from a frame with padding."""
    x, y, w, h = face_result['x'], face_result['y'], face_result['w'], face_result['h']
    fh_full, fw_full = frame.shape[:2]
    pad = int(max(w, h) * padding)
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(fw_full, x + w + pad)
    y2 = min(fh_full, y + h + pad)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return crop


def assign_stranger_id(face_result, session_stats):
    """
    Assign a unique stranger ID by comparing embedding AND position against
    previously seen strangers. Each stranger stores multiple embeddings and
    positions so the same person seen from different angles is still matched.

    Matching strategy (in order):
      1. Embedding similarity >= 0.20 → same stranger
      2. Position within 120px AND embedding similarity >= 0.10 → same stranger
         (handles back-of-head vs front-face at same desk)
      3. Otherwise → new stranger
    """
    embedding = face_result['embedding']
    cx = face_result['x'] + face_result['w'] // 2
    cy = face_result['y'] + face_result['h'] // 2

    stranger_embeddings = session_stats.get('stranger_embeddings', {})
    stranger_positions = session_stats.get('stranger_positions', {})
    embedding_threshold = 0.20
    position_threshold_px = 120
    position_min_sim = 0.10
    max_embeddings_per_stranger = 10

    best_id = None
    best_sim = 0.0

    # Strategy 1: Pure embedding match
    for sid, emb_list in stranger_embeddings.items():
        for emb in emb_list:
            sim = float(np.dot(emb, embedding))
            if sim > best_sim:
                best_sim = sim
                if sim >= embedding_threshold:
                    best_id = sid

    # Strategy 2: Position + weak embedding match (for angle changes)
    if best_id is None:
        best_pos_id = None
        best_pos_dist = float('inf')
        best_pos_sim = 0.0

        for sid, positions in stranger_positions.items():
            for (px, py) in positions:
                dist = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                if dist < best_pos_dist:
                    best_pos_dist = dist
                    # Check embedding similarity for this stranger
                    sid_best_sim = 0.0
                    for emb in stranger_embeddings.get(sid, []):
                        sim = float(np.dot(emb, embedding))
                        if sim > sid_best_sim:
                            sid_best_sim = sim
                    best_pos_sim = sid_best_sim
                    best_pos_id = sid

        if (best_pos_id is not None
                and best_pos_dist <= position_threshold_px
                and best_pos_sim >= position_min_sim):
            best_id = best_pos_id
            logger.info(f"    [Stranger] Position match: Stranger_{best_id} "
                  f"(dist={best_pos_dist:.0f}px, sim={best_pos_sim:.3f})")

    if best_id is not None:
        # Add embedding and position to existing stranger
        if len(stranger_embeddings[best_id]) < max_embeddings_per_stranger:
            stranger_embeddings[best_id].append(embedding)
        positions = stranger_positions.get(best_id, [])
        positions.append((cx, cy))
        stranger_positions[best_id] = positions[-20:]  # keep last 20 positions
        session_stats['stranger_positions'] = stranger_positions
        return best_id

    # New stranger
    new_id = (max(stranger_embeddings.keys()) + 1) if stranger_embeddings else 1
    stranger_embeddings[new_id] = [embedding]
    stranger_positions[new_id] = [(cx, cy)]
    session_stats['stranger_embeddings'] = stranger_embeddings
    session_stats['stranger_positions'] = stranger_positions
    return new_id


def merge_strangers(session_stats, similarity_threshold=0.30):
    """
    Merge stranger IDs that turn out to be the same person.
    Called after each batch to consolidate as embeddings accumulate.

    Two merge criteria:
      1. Embedding similarity >= threshold between any pair
      2. Average position within 120px AND any embedding similarity >= 0.10
    """
    stranger_embeddings = session_stats.get('stranger_embeddings', {})
    stranger_positions = session_stats.get('stranger_positions', {})
    face_crops = session_stats.get('face_crops', {})

    if len(stranger_embeddings) < 2:
        return

    sids = sorted(stranger_embeddings.keys())
    merge_map = {}  # old_id -> keep_id

    for i in range(len(sids)):
        sid_a = sids[i]
        if sid_a in merge_map:
            continue
        for j in range(i + 1, len(sids)):
            sid_b = sids[j]
            if sid_b in merge_map:
                continue

            should_merge = False

            # Criterion 1: Best embedding similarity
            best_sim = 0.0
            for emb_a in stranger_embeddings[sid_a]:
                for emb_b in stranger_embeddings[sid_b]:
                    sim = float(np.dot(emb_a, emb_b))
                    if sim > best_sim:
                        best_sim = sim

            if best_sim >= similarity_threshold:
                should_merge = True

            # Criterion 2: Position proximity + weak embedding match
            if not should_merge and best_sim >= 0.10:
                pos_a = stranger_positions.get(sid_a, [])
                pos_b = stranger_positions.get(sid_b, [])
                if pos_a and pos_b:
                    avg_a = (sum(p[0] for p in pos_a) / len(pos_a),
                             sum(p[1] for p in pos_a) / len(pos_a))
                    avg_b = (sum(p[0] for p in pos_b) / len(pos_b),
                             sum(p[1] for p in pos_b) / len(pos_b))
                    dist = ((avg_a[0] - avg_b[0]) ** 2 +
                            (avg_a[1] - avg_b[1]) ** 2) ** 0.5
                    if dist <= 120:
                        should_merge = True

            if should_merge:
                merge_map[sid_b] = sid_a

    if not merge_map:
        return

    # Apply merges
    for old_id, keep_id in merge_map.items():
        # Move embeddings
        stranger_embeddings[keep_id].extend(stranger_embeddings.pop(old_id))
        stranger_embeddings[keep_id] = stranger_embeddings[keep_id][:10]

        # Move positions
        if old_id in stranger_positions:
            keep_pos = stranger_positions.get(keep_id, [])
            keep_pos.extend(stranger_positions.pop(old_id))
            stranger_positions[keep_id] = keep_pos[-20:]

        # Update face_crops labels
        old_label = f"Stranger_{old_id}"
        keep_label = f"Stranger_{keep_id}"
        if old_label in face_crops:
            old_crop = face_crops.pop(old_label)
            if keep_label not in face_crops or \
               old_crop['det_score'] > face_crops[keep_label]['det_score']:
                old_crop['label'] = keep_label
                face_crops[keep_label] = old_crop

        # Merge appearance timestamps
        person_timestamps = session_stats.get('person_timestamps', {})
        if old_label in person_timestamps:
            old_ts = person_timestamps.pop(old_label)
            keep_ts = person_timestamps.get(keep_label, [])
            merged_ts = sorted(set(keep_ts + old_ts))
            person_timestamps[keep_label] = merged_ts

        logger.info(f"    [Merge] Stranger_{old_id} -> Stranger_{keep_id}")


def cross_batch_reidentify(session_stats, known_embeddings, confidence_threshold):
    """Re-identify accumulated strangers against current known embeddings.

    Standalone function usable by both FaceRecognizer and the dashboard.
    Runs after every batch to catch cross-angle matches across batches.

    Phase 1: Stranger → Known promotion
    Phase 2: Stranger → Stranger merge
    """
    stranger_embeddings = session_stats.get('stranger_embeddings', {})
    if not stranger_embeddings:
        return

    reclassified = 0
    merged = 0

    # ── Phase 1: Stranger → Known promotion ──────────────────────────
    promote_list = []  # [(sid, best_known_name, best_sim)]

    for sid, emb_list in list(stranger_embeddings.items()):
        best_name = None
        best_sim = 0.0

        for s_emb in emb_list:
            for kn_name, kn_emb in known_embeddings:
                sim = float(np.dot(kn_emb, s_emb))
                if sim > best_sim:
                    best_sim = sim
                    best_name = kn_name

        if best_sim >= confidence_threshold and best_name is not None:
            promote_list.append((sid, best_name, best_sim))

    for sid, known_name, sim in promote_list:
        old_label = f"Stranger_{sid}"
        logger.info("  [Cross-Batch] %s -> %s (sim=%.3f)", old_label, known_name, sim)

        # Transfer timestamps
        ts = session_stats.get('person_timestamps', {})
        old_ts = ts.pop(old_label, [])
        existing_ts = ts.get(known_name, [])
        merged_ts = sorted(set(existing_ts + old_ts))
        ts[known_name] = merged_ts
        session_stats['person_timestamps'] = ts

        # Transfer detection count
        count = len(old_ts) or 1
        session_stats['known_persons'][known_name] = \
            session_stats['known_persons'].get(known_name, 0) + count
        session_stats['total_known'] = \
            session_stats.get('total_known', 0) + count
        session_stats['total_strangers'] = max(
            0, session_stats.get('total_strangers', 0) - count)

        # Transfer face crop (keep higher det_score)
        face_crops = session_stats.get('face_crops', {})
        stranger_crop = face_crops.pop(old_label, None)
        if stranger_crop is not None:
            existing_crop = face_crops.get(known_name)
            if (existing_crop is None or
                    stranger_crop.get('det_score', 0) >
                    existing_crop.get('det_score', 0)):
                stranger_crop['label'] = known_name
                stranger_crop['sim_score'] = sim
                face_crops[known_name] = stranger_crop

        # Remove from stranger tracking
        stranger_embeddings.pop(sid, None)
        session_stats.get('stranger_positions', {}).pop(sid, None)

        reclassified += 1

    # ── Phase 2: Stranger → Stranger merge ───────────────────────────
    remaining_sids = sorted(stranger_embeddings.keys())
    merge_map = {}  # old_sid -> keep_sid

    for i, sid_a in enumerate(remaining_sids):
        if sid_a in merge_map:
            continue
        for sid_b in remaining_sids[i + 1:]:
            if sid_b in merge_map:
                continue

            embs_a = stranger_embeddings.get(sid_a, [])
            embs_b = stranger_embeddings.get(sid_b, [])

            best_sim = 0.0
            for ea in embs_a:
                for eb in embs_b:
                    sim = float(np.dot(ea, eb))
                    if sim > best_sim:
                        best_sim = sim

            if best_sim >= 0.30:
                merge_map[sid_b] = sid_a

    for old_sid, keep_sid in merge_map.items():
        old_label = f"Stranger_{old_sid}"
        keep_label = f"Stranger_{keep_sid}"
        logger.info("  [Cross-Batch] Merge %s -> %s (sim>=0.30)",
                    old_label, keep_label)

        # Merge embeddings (cap at 10)
        keep_embs = stranger_embeddings.get(keep_sid, [])
        old_embs = stranger_embeddings.pop(old_sid, [])
        keep_embs.extend(old_embs)
        stranger_embeddings[keep_sid] = keep_embs[:10]

        # Merge positions
        positions = session_stats.get('stranger_positions', {})
        keep_pos = positions.get(keep_sid, [])
        old_pos = positions.pop(old_sid, [])
        keep_pos.extend(old_pos)
        positions[keep_sid] = keep_pos[-20:]

        # Merge timestamps
        ts = session_stats.get('person_timestamps', {})
        old_ts = ts.pop(old_label, [])
        keep_ts = ts.get(keep_label, [])
        ts[keep_label] = sorted(set(keep_ts + old_ts))

        # Transfer face crop (keep higher det_score)
        face_crops = session_stats.get('face_crops', {})
        old_crop = face_crops.pop(old_label, None)
        if old_crop:
            keep_crop = face_crops.get(keep_label)
            if not keep_crop or \
               old_crop.get('det_score', 0) > keep_crop.get('det_score', 0):
                old_crop['label'] = keep_label
                face_crops[keep_label] = old_crop

        merged += 1

    if reclassified or merged:
        logger.info("  [Cross-Batch] Promoted %d stranger(s), merged %d pair(s)",
                    reclassified, merged)


def collect_face_crop(frame, face_result, session_stats, stranger_id=None):
    """
    Save the best face crop per unique person (known or stranger) in session_stats.
    Keeps the crop with the highest detection confidence.
    """
    if face_result['name'] == "Stranger" and stranger_id is not None:
        label = f"Stranger_{stranger_id}"
    else:
        label = face_result['name']

    det_score = face_result.get('det_score', 0.0)
    face_crops = session_stats.get('face_crops', {})

    # Keep the crop with the best detection confidence
    existing = face_crops.get(label)
    if existing is None or det_score > existing['det_score']:
        crop = crop_face(frame, face_result)
        if crop is not None:
            face_crops[label] = {
                'crop': crop,
                'det_score': det_score,
                'sim_score': face_result['score'],
                'label': label,
            }
            session_stats['face_crops'] = face_crops


def log_stranger_alert(frame, face_results, camera_name, alert_dir, alerts_list):
    """Log a stranger detection event."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    current_time = time.time()

    safe_name = camera_name.replace(' ', '_').lower()
    face_names = [r['name'] for r in face_results]
    stranger_count = sum(1 for n in face_names if n.startswith("Stranger"))
    known_names = [n for n in face_names if not n.startswith("Stranger")]

    alert = {
        'timestamp': timestamp,
        'camera': camera_name,
        'stranger_count': stranger_count,
        'known_faces_present': known_names,
        'total_faces': len(face_names),
        'frame_saved': f"stranger_alert_{safe_name}_{int(current_time)}.jpg"
    }

    alerts_list.append(alert)
    alert_path = os.path.join(alert_dir, alert['frame_saved'])
    cv2.imwrite(alert_path, frame)

    alerts_json_path = os.path.join(alert_dir, f'face_alerts_{safe_name}.json')
    with open(alerts_json_path, 'w') as f:
        json.dump(alerts_list, f, indent=2)


# ── Session Data (Module API) ─────────────────────────────────────────────────

class SessionData:
    """Encapsulates all session tracking state for the FaceRecognizer module."""

    def __init__(self):
        self.start_time = datetime.now()
        self.total_captures = 0
        self.total_analyses = 0
        self.frames_analysed = 0
        self.frames_with_faces = 0
        self.total_faces = 0
        self.total_known = 0
        self.total_strangers = 0
        self.known_persons = {}          # name -> detection count
        self.auto_learned = 0
        self.total_embeddings = 0
        self.face_crops = {}             # label -> {crop, det_score, sim_score, label}
        self.stranger_embeddings = {}    # id -> [embeddings]
        self.stranger_positions = {}     # id -> [(x,y)]
        self.person_timestamps = {}      # label -> [timestamp_strs]
        # New fields for module output
        self.person_cameras = {}         # label -> set(camera_names)
        self.timeline = []               # list of event dicts
        self.spatial_points = {}         # camera_name -> [(x, y)]
        self.temporal_points = {}        # camera_name -> [datetime]
        self.frame_sizes = {}            # camera_name -> (width, height)

    def as_legacy_dict(self):
        """Return a dict matching the current session_stats format for backward compat."""
        return {
            'start_time': self.start_time.strftime('%Y-%m-%d %H:%M:%S'),
            'total_captures': self.total_captures,
            'total_analyses': self.total_analyses,
            'frames_analysed': self.frames_analysed,
            'frames_with_faces': self.frames_with_faces,
            'total_faces': self.total_faces,
            'total_known': self.total_known,
            'total_strangers': self.total_strangers,
            'known_persons': self.known_persons,
            'auto_learned': self.auto_learned,
            'total_embeddings': self.total_embeddings,
            'face_crops': self.face_crops,
            'stranger_embeddings': self.stranger_embeddings,
            'stranger_positions': self.stranger_positions,
            'person_timestamps': self.person_timestamps,
        }

    def sync_from_dict(self, d):
        """Pull mutated values back from a legacy session_stats dict."""
        self.total_captures = d.get('total_captures', self.total_captures)
        self.total_analyses = d.get('total_analyses', self.total_analyses)
        self.frames_analysed = d.get('frames_analysed', self.frames_analysed)
        self.frames_with_faces = d.get('frames_with_faces', self.frames_with_faces)
        self.total_faces = d.get('total_faces', self.total_faces)
        self.total_known = d.get('total_known', self.total_known)
        self.total_strangers = d.get('total_strangers', self.total_strangers)
        self.known_persons = d.get('known_persons', self.known_persons)
        self.auto_learned = d.get('auto_learned', self.auto_learned)
        self.total_embeddings = d.get('total_embeddings', self.total_embeddings)
        self.face_crops = d.get('face_crops', self.face_crops)
        self.stranger_embeddings = d.get('stranger_embeddings', self.stranger_embeddings)
        self.stranger_positions = d.get('stranger_positions', self.stranger_positions)
        self.person_timestamps = d.get('person_timestamps', self.person_timestamps)

    def build_output(self, output_dir=None):
        """Build the structured output dict for the module API."""
        end_time = datetime.now()
        duration = (end_time - self.start_time).total_seconds()

        output = {
            "session": {
                "start": self.start_time.isoformat(),
                "end": end_time.isoformat(),
                "duration_seconds": duration,
                "total_captures": self.total_captures,
                "total_analyses": self.total_analyses,
                "total_detections": self.total_faces,
                "frames_analysed": self.frames_analysed,
                "frames_with_faces": self.frames_with_faces,
                "auto_learned": self.auto_learned,
                "total_embeddings": self.total_embeddings,
            },
            "known_persons": {},
            "unknown_persons": {},
            "heatmaps": {},
            "timeline": self.timeline,
        }

        # Known persons — green border on crops
        for name, count in self.known_persons.items():
            timestamps = self.person_timestamps.get(name, [])
            cameras = sorted(self.person_cameras.get(name, set()))
            crop_data = self.face_crops.get(name)
            best_crop_b64 = None
            if crop_data and crop_data.get('crop') is not None:
                bordered = self._add_crop_label(
                    crop_data['crop'], name,
                    border_color=(0, 180, 0), bg_color=(0, 140, 0))
                _, buf = cv2.imencode('.png', bordered)
                best_crop_b64 = base64.b64encode(buf).decode('ascii')
            output["known_persons"][name] = {
                "type": "known",
                "name": name,
                "count": count,
                "first_seen": timestamps[0] if timestamps else None,
                "last_seen": timestamps[-1] if timestamps else None,
                "timestamps": timestamps,
                "cameras": cameras,
                "best_crop": best_crop_b64,
                "avg_confidence": round(crop_data['sim_score'], 4) if crop_data else None,
            }

        # Unknown persons — red border on crops
        for sid in sorted(self.stranger_embeddings.keys()):
            label = f"Unknown_{sid}"
            internal_label = f"Stranger_{sid}"
            timestamps = self.person_timestamps.get(internal_label, [])
            cameras = sorted(self.person_cameras.get(internal_label, set()))
            crop_data = self.face_crops.get(internal_label)
            best_crop_b64 = None
            if crop_data and crop_data.get('crop') is not None:
                bordered = self._add_crop_label(
                    crop_data['crop'], label,
                    border_color=(0, 0, 220), bg_color=(0, 0, 170))
                _, buf = cv2.imencode('.png', bordered)
                best_crop_b64 = base64.b64encode(buf).decode('ascii')
            output["unknown_persons"][label] = {
                "type": "unknown",
                "label": label,
                "count": len(timestamps),
                "first_seen": timestamps[0] if timestamps else None,
                "last_seen": timestamps[-1] if timestamps else None,
                "timestamps": timestamps,
                "cameras": cameras,
                "best_crop": best_crop_b64,
            }

        # Heatmaps
        all_cameras = set(list(self.spatial_points.keys()) +
                          list(self.temporal_points.keys()))
        for camera_name in all_cameras:
            spatial_png = self._generate_spatial_heatmap(camera_name)
            temporal_png = self._generate_temporal_heatmap(camera_name)
            output["heatmaps"][camera_name] = {
                "spatial": base64.b64encode(spatial_png).decode('ascii')
                           if spatial_png else None,
                "temporal": base64.b64encode(temporal_png).decode('ascii')
                            if temporal_png else None,
            }

        return output

    @staticmethod
    def _add_crop_label(crop, label, border_color=(0, 180, 0),
                        bg_color=(0, 140, 0), thickness=4):
        """Add a colored border and name label bar to a face crop image.

        Known persons get green border+label, unknown get red.
        This makes them visually distinct at a glance.
        """
        if crop is None or crop.size == 0:
            return crop

        h, w = crop.shape[:2]

        # Add border
        bordered = cv2.copyMakeBorder(
            crop, thickness, thickness, thickness, thickness,
            cv2.BORDER_CONSTANT, value=border_color)

        # Add label bar at the bottom
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = max(0.4, min(0.7, w / 200))
        text_thickness = max(1, int(font_scale * 2))
        (tw, th), baseline = cv2.getTextSize(label, font, font_scale, text_thickness)

        bar_height = th + baseline + 12
        bar = np.zeros((bar_height, bordered.shape[1], 3), dtype=np.uint8)
        bar[:] = bg_color

        # Center the text in the bar
        tx = max(4, (bordered.shape[1] - tw) // 2)
        ty = th + 6
        cv2.putText(bar, label, (tx, ty), font, font_scale,
                    (255, 255, 255), text_thickness, cv2.LINE_AA)

        # Stack: bordered image + label bar
        result = np.vstack([bordered, bar])
        return result

    def _generate_spatial_heatmap(self, camera_name, width=640, height=480):
        """Generate a spatial heatmap PNG from accumulated detection positions."""
        points = self.spatial_points.get(camera_name, [])
        if not points:
            return None

        # Use actual frame size if available
        fw, fh = self.frame_sizes.get(camera_name, (width, height))

        heatmap = np.zeros((fh, fw), dtype=np.float32)
        for (x, y) in points:
            gx = max(0, min(fw - 1, int(x)))
            gy = max(0, min(fh - 1, int(y)))
            heatmap[gy, gx] += 1.0

        # Gaussian blur for smooth density
        ksize = max(51, (min(fw, fh) // 8) | 1)  # odd kernel
        heatmap = cv2.GaussianBlur(heatmap, (ksize, ksize), 0)

        # Normalize to 0-255
        if heatmap.max() > 0:
            heatmap = (heatmap / heatmap.max() * 255).astype(np.uint8)
        else:
            heatmap = heatmap.astype(np.uint8)

        colored = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)

        _, buf = cv2.imencode('.png', colored)
        return buf.tobytes()

    def _generate_temporal_heatmap(self, camera_name, width=800, height=200,
                                   bin_minutes=1):
        """Generate a temporal heatmap (time-series bar chart) as PNG."""
        timestamps = self.temporal_points.get(camera_name, [])
        if not timestamps:
            return None

        start = min(timestamps)
        end = max(timestamps)
        bin_seconds = bin_minutes * 60
        total_seconds = (end - start).total_seconds()
        total_bins = max(1, int(total_seconds / bin_seconds) + 1)
        bins = [0] * total_bins

        for ts in timestamps:
            idx = int((ts - start).total_seconds() / bin_seconds)
            idx = min(idx, total_bins - 1)
            bins[idx] += 1

        # Render bar chart with OpenCV
        img = np.zeros((height, width, 3), dtype=np.uint8)
        img[:] = (30, 30, 30)  # dark background

        max_count = max(bins) if bins else 1
        bar_width = max(1, (width - 80) // total_bins)  # leave margins
        margin_left = 40

        for i, count in enumerate(bins):
            bar_height = int((count / max_count) * (height - 50))
            x1 = margin_left + i * bar_width
            x2 = min(x1 + bar_width - 1, width - 40)
            y1 = height - 30 - bar_height
            y2 = height - 30
            color = (0, 180, 255)  # orange
            cv2.rectangle(img, (x1, y1), (x2, y2), color, -1)

        # Time labels
        cv2.putText(img, start.strftime("%H:%M"), (margin_left, height - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        cv2.putText(img, end.strftime("%H:%M"), (width - 70, height - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        # Y-axis label
        cv2.putText(img, str(max_count), (5, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        cv2.putText(img, "0", (5, height - 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        # Title
        cv2.putText(img, f"Detections over time - {camera_name}",
                    (margin_left, 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        _, buf = cv2.imencode('.png', img)
        return buf.tobytes()


# ── Summary Report ─────────────────────────────────────────────────────────────

def print_summary(session_stats, captures_dir='./captures', summary_config=None):
    """Print and save session summary report with cropped face images."""
    if summary_config is None:
        summary_config = {}

    known_persons = session_stats.get('known_persons', {})
    face_crops = session_stats.get('face_crops', {})
    stranger_embeddings = session_stats.get('stranger_embeddings', {})

    # Create summary directory and save cropped faces
    summary_dir = summary_config.get(
        'summary_dir', os.path.join(captures_dir, 'summary'))
    os.makedirs(summary_dir, exist_ok=True)

    # Separate known and stranger crops
    known_crops = {}
    stranger_crops = {}
    for label, data in face_crops.items():
        if label.startswith('Stranger_'):
            stranger_crops[label] = data
        else:
            known_crops[label] = data

    # Save all crops to summary directory
    saved_files = {}
    for label, data in face_crops.items():
        safe_label = label.replace(' ', '_')
        filename = f"{safe_label}.jpg"
        filepath = os.path.join(summary_dir, filename)
        cv2.imwrite(filepath, data['crop'])
        saved_files[label] = filepath

    num_known = len(known_persons)
    num_strangers = len(stranger_embeddings)

    # ── Console output ────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"SESSION SUMMARY REPORT")
    print(f"{'='*60}")
    print(f"Start time:       {session_stats['start_time']}")
    print(f"End time:         {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Total captures:   {session_stats['total_captures']}")
    print(f"Analyses run:     {session_stats['total_analyses']}")
    print(f"")

    # --- Known Persons ---
    print(f"--- Known Persons: {num_known} ---")
    if known_persons:
        for name, count in sorted(known_persons.items()):
            crop_path = saved_files.get(name, 'N/A')
            print(f"  {name}")
            print(f"    Detected: {count}x")
            print(f"    Crop:     {crop_path}")
    else:
        print(f"  (none)")
    print(f"")

    # --- Unknown Persons ---
    print(f"--- Unknown Persons: {num_strangers} ---")
    if stranger_crops:
        for label in sorted(stranger_crops.keys()):
            crop_path = saved_files.get(label, 'N/A')
            print(f"  {label}")
            print(f"    Crop: {crop_path}")
    else:
        print(f"  (none)")
    print(f"")

    # --- Detection Stats ---
    print(f"--- Detection Stats ---")
    print(f"Frames analysed:        {session_stats['frames_analysed']}")
    print(f"Frames with faces:      {session_stats['frames_with_faces']}")
    print(f"Total face detections:  {session_stats['total_faces']}")
    print(f"")

    # --- AI Model Info ---
    print(f"--- AI Model Info ---")
    print(f"Pipeline:        YOLO + SCRFD (two-stage)")
    print(f"Person detect:   YOLOv8n")
    print(f"Face detect:     SCRFD-10GF (InsightFace)")
    print(f"Embeddings:      ArcFace ResNet50 (WebFace600K, 512-d)")
    print(f"Auto-learned:    {session_stats['auto_learned']} new training images")
    print(f"Total embeddings: {session_stats['total_embeddings']}")
    print(f"")

    # --- Summary Directory ---
    print(f"--- Face Crops ---")
    print(f"Summary dir: {summary_dir}")
    if saved_files:
        for label, path in sorted(saved_files.items()):
            print(f"  {label}: {path}")
    else:
        print(f"  (no faces detected)")
    print(f"{'='*60}\n")

    # ── JSON summary ──────────────────────────────────────────────
    if summary_config.get('save_json', True):
        json_summary = {
            'start_time': session_stats['start_time'],
            'end_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_captures': session_stats['total_captures'],
            'total_analyses': session_stats['total_analyses'],
            'detection_pipeline': 'YOLO + SCRFD (two-stage)',
            'known_persons': {},
            'unknown_persons': [],
            'detection_stats': {
                'frames_analysed': session_stats['frames_analysed'],
                'frames_with_faces': session_stats['frames_with_faces'],
                'total_face_detections': session_stats['total_faces'],
            },
            'auto_learned': session_stats['auto_learned'],
            'total_embeddings': session_stats['total_embeddings'],
        }

        for name, count in sorted(known_persons.items()):
            json_summary['known_persons'][name] = {
                'detection_count': count,
                'crop_file': saved_files.get(name, None),
            }

        for label in sorted(stranger_crops.keys()):
            json_summary['unknown_persons'].append({
                'label': label,
                'crop_file': saved_files.get(label, None),
            })

        json_path = os.path.join(summary_dir, 'summary.json')
        with open(json_path, 'w') as f:
            json.dump(json_summary, f, indent=2)
        logger.info(f"JSON summary: {json_path}")

    # ── HTML summary ──────────────────────────────────────────────
    if summary_config.get('generate_html', True):
        html_path = os.path.join(summary_dir, 'summary.html')
        _generate_html_summary(json_summary, saved_files, html_path)
        logger.info(f"HTML summary: {html_path}")


def _generate_html_summary(summary_data, saved_files, html_path):
    """Generate an HTML summary report with embedded face crop images."""
    known = summary_data.get('known_persons', {})
    unknowns = summary_data.get('unknown_persons', [])
    stats = summary_data.get('detection_stats', {})

    html_parts = [
        '<!DOCTYPE html><html><head>',
        '<meta charset="utf-8">',
        f'<title>Face Recognition Summary - {summary_data["end_time"]}</title>',
        '<style>',
        'body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;'
        'max-width:900px;margin:0 auto;padding:20px;background:#f5f5f5}',
        '.card{background:#fff;border-radius:12px;padding:20px;margin:15px 0;'
        'box-shadow:0 2px 8px rgba(0,0,0,0.1)}',
        '.person{display:inline-block;margin:10px;text-align:center;'
        'vertical-align:top;width:180px}',
        '.person img{width:160px;height:160px;object-fit:cover;'
        'border-radius:8px;border:3px solid #4CAF50}',
        '.stranger img{border-color:#f44336}',
        'h1{color:#333;margin-bottom:5px}',
        'h2{color:#555;border-bottom:2px solid #eee;padding-bottom:8px}',
        '.meta{color:#888;font-size:14px}',
        '.stat{display:inline-block;background:#e3f2fd;padding:8px 16px;'
        'border-radius:20px;margin:4px;font-size:14px}',
        '.stat.alert{background:#ffebee;color:#c62828}',
        '.stat.ok{background:#e8f5e9;color:#2e7d32}',
        '</style></head><body>',
        '<div class="card">',
        f'<h1>Session Summary</h1>',
        f'<p class="meta">{summary_data["start_time"]} — '
        f'{summary_data["end_time"]}</p>',
        f'<p class="meta">Pipeline: {summary_data["detection_pipeline"]}</p>',
        f'<span class="stat">Captures: {summary_data["total_captures"]}</span>',
        f'<span class="stat">Frames analysed: {stats.get("frames_analysed", 0)}</span>',
        f'<span class="stat">Faces detected: {stats.get("total_face_detections", 0)}</span>',
        '</div>',
    ]

    # Known persons
    html_parts.append('<div class="card">')
    html_parts.append(f'<h2>Known Persons ({len(known)})</h2>')
    if known:
        for name, info in known.items():
            crop_path = info.get('crop_file')
            img_tag = '<div style="width:160px;height:160px;background:#eee;'
            img_tag += 'border-radius:8px;display:flex;align-items:center;'
            img_tag += 'justify-content:center;color:#999">No photo</div>'
            if crop_path and os.path.exists(crop_path):
                with open(crop_path, 'rb') as f:
                    b64 = base64.b64encode(f.read()).decode()
                img_tag = f'<img src="data:image/jpeg;base64,{b64}">'
            html_parts.append(
                f'<div class="person"><div>{img_tag}</div>'
                f'<b>{name}</b><br>'
                f'<span class="stat ok">Seen {info["detection_count"]}x</span></div>'
            )
    else:
        html_parts.append('<p style="color:#999">No known persons detected</p>')
    html_parts.append('</div>')

    # Unknown persons
    html_parts.append('<div class="card">')
    html_parts.append(f'<h2>Unknown Persons ({len(unknowns)})</h2>')
    if unknowns:
        for info in unknowns:
            crop_path = info.get('crop_file')
            img_tag = '<div style="width:160px;height:160px;background:#eee;'
            img_tag += 'border-radius:8px;display:flex;align-items:center;'
            img_tag += 'justify-content:center;color:#999">No photo</div>'
            if crop_path and os.path.exists(crop_path):
                with open(crop_path, 'rb') as f:
                    b64 = base64.b64encode(f.read()).decode()
                img_tag = f'<img src="data:image/jpeg;base64,{b64}">'
            html_parts.append(
                f'<div class="person stranger"><div>{img_tag}</div>'
                f'<b>{info["label"]}</b></div>'
            )
    else:
        html_parts.append('<p style="color:#999">No unknown persons detected</p>')
    html_parts.append('</div>')

    html_parts.append('</body></html>')

    with open(html_path, 'w') as f:
        f.write('\n'.join(html_parts))


# ── FaceRecognizer Module API ──────────────────────────────────────────────────

class FaceRecognizer:
    """
    Plug-and-play face recognition module.

    Usage:
        fr = FaceRecognizer(
            cameras=[{"name": "Front Door", "url": "rtsp://..."}],
            known_faces={"Alice": ["/path/to/alice1.jpg"]},
            models={"yolo": "/path/to/yolov8n.pt"},
            on_person_detected=my_callback,
        )
        fr.start()
        status = fr.get_status()
        summary = fr.stop()  # returns dict + saves JSON files
    """

    def __init__(self, cameras, known_faces=None, models=None,
                 on_person_detected=None, confidence_threshold=0.35,
                 capture_interval=2, analyse_every=5,
                 det_size=(640, 640), output_dir=None,
                 auto_learn=True, auto_learn_threshold=0.35,
                 max_auto_learn_per_person=15,
                 save_captures=True):
        """
        Args:
            cameras: list of {"name": str, "url": str or int}
            known_faces: dict {"name": ["img_paths"]} or str (directory path) or None
            models: dict with optional keys: "yolo" -> path to yolov8n.pt
            on_person_detected: callback(event_dict) fired per detection in real-time
            confidence_threshold: cosine similarity threshold for recognition
            capture_interval: seconds between frame captures
            analyse_every: number of captures per analysis batch
            det_size: SCRFD detection input size tuple
            output_dir: directory for captures/summaries (default: temp dir)
            auto_learn: enable auto-learning of new face angles from CCTV
            auto_learn_threshold: minimum similarity for auto-learn
            max_auto_learn_per_person: cap auto-learned images per person
            save_captures: save capture frames and alerts to disk (default: True)
        """
        if not cameras:
            raise ValueError("At least one camera is required")

        self._cameras = cameras
        self._models = models or {}
        self._on_person_detected = on_person_detected
        self._confidence_threshold = confidence_threshold
        self._capture_interval = capture_interval
        self._analyse_every = analyse_every
        self._det_size = det_size
        self._auto_learn = auto_learn
        self._auto_learn_threshold = auto_learn_threshold
        self._max_auto_learn_per_person = max_auto_learn_per_person
        self._save_captures = save_captures

        self._output_dir = output_dir or tempfile.mkdtemp(prefix="face_recognizer_")
        os.makedirs(self._output_dir, exist_ok=True)

        # Setup known faces directory
        self._known_faces_dir = os.path.join(self._output_dir, "known_faces")
        self._setup_known_faces(known_faces)

        self._engine = None
        self._session = None
        self._stop_event = None
        self._threads = []
        self._lock = threading.Lock()
        self._running = False

    def _setup_known_faces(self, known_faces):
        """Populate the known_faces directory from user input."""
        if known_faces is None:
            os.makedirs(self._known_faces_dir, exist_ok=True)
            return

        if isinstance(known_faces, str):
            # It's a directory path — use it directly
            self._known_faces_dir = known_faces
            os.makedirs(self._known_faces_dir, exist_ok=True)
            return

        # It's a dict: {"name": ["path1.jpg", "path2.jpg"]}
        os.makedirs(self._known_faces_dir, exist_ok=True)
        for name, paths in known_faces.items():
            if isinstance(paths, str):
                paths = [paths]
            safe_name = name.replace(' ', '_')
            for i, path in enumerate(paths):
                ext = os.path.splitext(path)[1] or '.jpg'
                if i == 0:
                    dest_name = f"{safe_name}{ext}"
                else:
                    dest_name = f"{safe_name}_{i+1}{ext}"
                shutil.copy2(path, os.path.join(self._known_faces_dir, dest_name))

    def start(self):
        """Initialize models and begin camera processing threads."""
        with self._lock:
            if self._running:
                raise RuntimeError("FaceRecognizer is already running")

            # Build YOLO config from models dict
            yolo_config = None
            if 'yolo' in self._models:
                yolo_config = {
                    'model_path': self._models['yolo'],
                    'imgsz': self._models.get('yolo_imgsz', 1280),
                    'person_conf': self._models.get('yolo_person_conf', 0.30),
                    'crop_padding': self._models.get('yolo_crop_padding', 0.3),
                    'min_person_height': self._models.get('yolo_min_person_height', 80),
                }

            # Initialize engine (loads models — takes 10-20s)
            self._engine = FaceRecognitionEngine(
                known_faces_dir=self._known_faces_dir,
                confidence_threshold=self._confidence_threshold,
                det_size=self._det_size,
                yolo_config=yolo_config,
            )

            self._session = SessionData()
            self._session.total_embeddings = len(self._engine.known_embeddings)
            self._stop_event = threading.Event()
            self._running = True

        # Start a thread per camera
        for cam_cfg in self._cameras:
            t = threading.Thread(
                target=self._camera_loop,
                args=(cam_cfg,),
                daemon=True,
                name=f"camera-{cam_cfg.get('name', 'unknown')}",
            )
            self._threads.append(t)
            t.start()

        logger.info("FaceRecognizer started with %d camera(s)", len(self._cameras))

    def stop(self):
        """Stop all cameras, generate output, return structured summary dict."""
        with self._lock:
            if not self._running:
                raise RuntimeError("FaceRecognizer is not running")
            self._stop_event.set()

        # Wait for threads to finish
        for t in self._threads:
            t.join(timeout=10)
        self._threads.clear()

        with self._lock:
            self._running = False
            self._session.total_embeddings = len(self._engine.known_embeddings)

        # Build structured output
        output = self._session.build_output(output_dir=self._output_dir)

        # Save JSON files
        self._save_output_files(output)

        logger.info("FaceRecognizer stopped. Summary saved to %s", self._output_dir)
        return output

    def get_status(self):
        """Return a snapshot of the current session state."""
        with self._lock:
            if not self._running:
                return {"status": "stopped"}
            s = self._session
            return {
                "status": "running",
                "uptime_seconds": round(
                    (datetime.now() - s.start_time).total_seconds(), 1),
                "total_captures": s.total_captures,
                "total_analyses": s.total_analyses,
                "total_detections": s.total_faces,
                "known_persons_detected": dict(s.known_persons),
                "unknown_persons_count": len(s.stranger_embeddings),
                "total_embeddings": len(self._engine.known_embeddings),
                "cameras": [c.get('name', 'Camera') for c in self._cameras],
            }

    def add_known_face(self, name, image_path):
        """Add a new known face at runtime. Hot-reloads engine embeddings."""
        safe_name = name.replace(' ', '_')
        ext = os.path.splitext(image_path)[1] or '.jpg'
        existing = [f for f in os.listdir(self._known_faces_dir)
                    if f.lower().startswith(safe_name.lower())
                    and f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        if existing:
            filename = f"{safe_name}_{len(existing)+1}{ext}"
        else:
            filename = f"{safe_name}{ext}"
        dest = os.path.join(self._known_faces_dir, filename)
        shutil.copy2(image_path, dest)

        if self._engine is not None:
            self._engine._load_known_faces()
            logger.info("Added face for '%s', total embeddings: %d",
                        name, len(self._engine.known_embeddings))

    def remove_known_face(self, name):
        """Remove all known face images for a person. Hot-reloads engine."""
        removed = 0
        for filename in os.listdir(self._known_faces_dir):
            if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            file_person = get_person_name(filename)
            if file_person.lower() == name.lower():
                os.remove(os.path.join(self._known_faces_dir, filename))
                removed += 1
        if self._engine is not None:
            self._engine._load_known_faces()
        logger.info("Removed %d image(s) for '%s', total embeddings: %d",
                    removed, name,
                    len(self._engine.known_embeddings) if self._engine else 0)

    def _camera_loop(self, cam_cfg):
        """Internal camera thread: capture frames, analyse batches, fire callbacks."""
        camera_name = cam_cfg.get('name', 'Camera')
        camera_url = cam_cfg.get('url', '')
        batch_frames = []
        batch_timestamps = []
        capture_count = 0

        # Setup camera-specific directories
        safe_cam = camera_name.replace(' ', '_').lower()
        camera_captures_dir = os.path.join(self._output_dir, safe_cam)
        os.makedirs(camera_captures_dir, exist_ok=True)

        alert_dir = os.path.join(self._output_dir, 'alerts')
        os.makedirs(alert_dir, exist_ok=True)

        pipeline = "YOLO + InsightFace" if self._engine.person_detector else "InsightFace"
        logger.info("[%s] Pipeline: %s | Capture every %ds, analyse every %d",
                    camera_name, pipeline, self._capture_interval, self._analyse_every)

        # Legacy session_stats dict — shared reference for analyse_batch
        legacy_stats = self._session.as_legacy_dict()

        while not self._stop_event.is_set():
            # Capture frame
            frame = capture_frame(camera_url, camera_name)
            if frame is None:
                self._stop_event.wait(self._capture_interval)
                continue

            capture_count += 1
            cap_time = datetime.now()
            timestamp = cap_time.strftime('%Y%m%d_%H%M%S')

            batch_frames.append(frame)
            batch_timestamps.append(cap_time)
            legacy_stats['total_captures'] = legacy_stats.get('total_captures', 0) + 1

            # Record frame size for heatmap
            fh, fw = frame.shape[:2]
            self._session.frame_sizes[camera_name] = (fw, fh)

            logger.info("[%s] Capture #%d at %s - OK (%dx%d)",
                        camera_name, capture_count, timestamp, fw, fh)

            # Trigger batch analysis
            if len(batch_frames) >= self._analyse_every:
                self._run_batch(batch_frames, batch_timestamps,
                                camera_name, legacy_stats,
                                camera_captures_dir, alert_dir)
                batch_frames = []
                batch_timestamps = []

            self._stop_event.wait(self._capture_interval)

        # Process remaining frames on shutdown
        if batch_frames:
            logger.info("[%s] Analysing remaining %d frame(s)...",
                        camera_name, len(batch_frames))
            self._run_batch(batch_frames, batch_timestamps,
                            camera_name, legacy_stats,
                            camera_captures_dir, alert_dir)

        logger.info("[%s] Stopped. Total captures: %d", camera_name, capture_count)

    def _run_batch(self, batch_frames, batch_timestamps, camera_name,
                   legacy_stats, camera_captures_dir, alert_dir):
        """Run analyse_batch and collect module-level data (heatmaps, timeline, callbacks)."""
        # Snapshot known_persons before analysis to detect new detections
        prev_timestamps = {k: len(v) for k, v in
                           legacy_stats.get('person_timestamps', {}).items()}

        # Maintain per-camera alerts list
        if not hasattr(self, '_alerts_lists'):
            self._alerts_lists = {}
        if camera_name not in self._alerts_lists:
            self._alerts_lists[camera_name] = []

        # Capture face positions via on_frame_analysed callback for spatial heatmap
        if camera_name not in self._session.spatial_points:
            self._session.spatial_points[camera_name] = []

        def _on_frame(annotated, face_results, cap_time, person_boxes=None):
            for r in face_results:
                cx = r['x'] + r['w'] // 2
                cy = r['y'] + r['h'] // 2
                self._session.spatial_points[camera_name].append((cx, cy))

        analyse_batch(
            batch_frames, batch_timestamps, self._engine,
            self._known_faces_dir, camera_name,
            camera_captures_dir, alert_dir,
            self._alerts_lists[camera_name], legacy_stats,
            on_frame_analysed=_on_frame,
            save_captures=self._save_captures,
        )

        # Sync legacy dict back to SessionData
        self._session.sync_from_dict(legacy_stats)

        # Cross-batch re-identification: re-check ALL accumulated strangers
        # against current known embeddings and against each other
        self._cross_batch_reidentify(legacy_stats)
        self._session.sync_from_dict(legacy_stats)  # sync again after reclassifications

        # Collect new detections for heatmap + timeline + callbacks
        current_timestamps = legacy_stats.get('person_timestamps', {})
        for label, ts_list in current_timestamps.items():
            prev_count = prev_timestamps.get(label, 0)
            new_timestamps = ts_list[prev_count:]

            for ts_str in new_timestamps:
                # Record camera association
                if label not in self._session.person_cameras:
                    self._session.person_cameras[label] = set()
                self._session.person_cameras[label].add(camera_name)

                # Record temporal point
                if camera_name not in self._session.temporal_points:
                    self._session.temporal_points[camera_name] = []
                try:
                    ts_dt = datetime.strptime(ts_str, '%H:%M:%S').replace(
                        year=datetime.now().year,
                        month=datetime.now().month,
                        day=datetime.now().day)
                except (ValueError, TypeError):
                    ts_dt = datetime.now()
                self._session.temporal_points[camera_name].append(ts_dt)

                # Determine known/unknown
                is_known = not label.startswith('Stranger_')
                person_type = "known" if is_known else "unknown"
                display_name = label if is_known else label.replace('Stranger_', 'Unknown_')

                # Timeline event
                self._session.timeline.append({
                    "time": ts_dt.isoformat(),
                    "person": display_name,
                    "camera": camera_name,
                    "type": person_type,
                })

                # Fire callback
                if self._on_person_detected:
                    crop_data = legacy_stats.get('face_crops', {}).get(label)
                    crop_b64 = None
                    if crop_data and crop_data.get('crop') is not None:
                        _, buf = cv2.imencode('.png', crop_data['crop'])
                        crop_b64 = base64.b64encode(buf).decode('ascii')
                    event = {
                        "person": display_name,
                        "type": person_type,
                        "camera": camera_name,
                        "timestamp": ts_dt.isoformat(),
                        "confidence": round(crop_data['sim_score'], 4) if crop_data else 0,
                        "crop": crop_b64,
                    }
                    try:
                        self._on_person_detected(event)
                    except Exception as e:
                        logger.warning("on_person_detected callback error: %s", e)

        # Spatial points are now collected via the _on_frame callback above

    def _cross_batch_reidentify(self, legacy_stats):
        """Re-identify all accumulated strangers against current known embeddings.

        Delegates to the standalone cross_batch_reidentify function, then
        handles FaceRecognizer-specific camera association transfers.
        """
        # Snapshot stranger labels before re-identification
        old_stranger_labels = set()
        for sid in legacy_stats.get('stranger_embeddings', {}):
            old_stranger_labels.add(f"Stranger_{sid}")

        # Run the standalone cross-batch re-identification
        cross_batch_reidentify(
            legacy_stats,
            self._engine.known_embeddings,
            self._confidence_threshold,
        )

        # Transfer camera associations for any strangers that were promoted/merged
        remaining_labels = set()
        for sid in legacy_stats.get('stranger_embeddings', {}):
            remaining_labels.add(f"Stranger_{sid}")

        removed_labels = old_stranger_labels - remaining_labels
        for old_label in removed_labels:
            if old_label in self._session.person_cameras:
                cams = self._session.person_cameras.pop(old_label)
                # Find the target label (promoted to known or merged)
                # Check person_timestamps for the destination
                ts = legacy_stats.get('person_timestamps', {})
                for target_label, target_ts in ts.items():
                    if not target_label.startswith('Stranger_') or \
                       target_label in remaining_labels:
                        # Could be the promoted known name
                        if target_label not in self._session.person_cameras:
                            self._session.person_cameras[target_label] = set()
                        self._session.person_cameras[target_label].update(cams)
                        break

        # ── Phase 3: Known → Known high-similarity warning ───────────────
        known_embs = self._engine.known_embeddings if self._engine else []
        if known_embs:
            person_groups = {}
            for kn_name, kn_emb in known_embs:
                person_groups.setdefault(kn_name, []).append(kn_emb)

            names = sorted(person_groups.keys())
            for i, name_a in enumerate(names):
                for name_b in names[i + 1:]:
                    best_cross = 0.0
                    for ea in person_groups[name_a]:
                        for eb in person_groups[name_b]:
                            sim = float(np.dot(ea, eb))
                            if sim > best_cross:
                                best_cross = sim
                    if best_cross >= 0.50:
                        logger.warning(
                            "  [Cross-Batch] High similarity between '%s' and '%s' "
                            "(sim=%.3f) — possibly same person?", name_a, name_b, best_cross)

        # Note: standalone cross_batch_reidentify already logs promotion/merge counts

    def _save_output_files(self, output):
        """Save output as JSON files and image files to output_dir."""
        summary_dir = os.path.join(self._output_dir, "summary")
        os.makedirs(summary_dir, exist_ok=True)

        # Build JSON-safe version (strip binary crop data for the JSON file)
        json_output = json.loads(json.dumps(output, default=str))

        # Save main summary JSON
        json_path = os.path.join(summary_dir, "summary.json")
        with open(json_path, 'w') as f:
            json.dump(json_output, f, indent=2, default=str)
        logger.info("JSON summary saved: %s", json_path)

        # Save face crops as individual PNG files
        for name, data in output.get("known_persons", {}).items():
            if data.get("best_crop"):
                crop_bytes = base64.b64decode(data["best_crop"])
                safe = name.replace(' ', '_')
                crop_path = os.path.join(summary_dir, f"{safe}.png")
                with open(crop_path, 'wb') as f:
                    f.write(crop_bytes)

        for label, data in output.get("unknown_persons", {}).items():
            if data.get("best_crop"):
                crop_bytes = base64.b64decode(data["best_crop"])
                safe = label.replace(' ', '_')
                crop_path = os.path.join(summary_dir, f"{safe}.png")
                with open(crop_path, 'wb') as f:
                    f.write(crop_bytes)

        # Save heatmap PNGs
        for camera_name, hm_data in output.get("heatmaps", {}).items():
            safe_cam = camera_name.replace(' ', '_').lower()
            if hm_data.get("spatial"):
                path = os.path.join(summary_dir, f"heatmap_spatial_{safe_cam}.png")
                with open(path, 'wb') as f:
                    f.write(base64.b64decode(hm_data["spatial"]))
            if hm_data.get("temporal"):
                path = os.path.join(summary_dir, f"heatmap_temporal_{safe_cam}.png")
                with open(path, 'wb') as f:
                    f.write(base64.b64decode(hm_data["temporal"]))

        logger.info("Output files saved to: %s", summary_dir)


# ── Batch Analysis ─────────────────────────────────────────────────────────────

def analyse_batch(batch_frames, batch_timestamps, engine,
                  known_faces_dir, camera_name,
                  captures_dir, alert_dir, alerts_list, session_stats,
                  on_frame_analysed=None, save_captures=True):
    """
    Analyse a batch of captured frames with iterative self-learning.

    Args:
        on_frame_analysed: Optional callback(annotated_frame, face_results, cap_time)
            called after each frame is analysed. Used by the dashboard for live updates.
    """
    safe_name = camera_name.replace(' ', '_').lower()
    camera_captures_dir = os.path.join(captures_dir, safe_name)
    session_stats['total_analyses'] += 1

    logger.info(f"\n  [Analyse] Analysing {len(batch_frames)} frames "
          f"(YOLO+SCRFD, self-learning)...")

    # Run YOLO person detection ONCE per frame — cache results.
    # Only SCRFD re-runs on subsequent passes with updated embeddings.
    cached_persons = []  # list of (frame, cap_time, person_boxes)
    for frame, cap_time in zip(batch_frames, batch_timestamps):
        if engine.person_detector:
            persons = engine.person_detector.detect_persons(frame)
        else:
            persons = []
        cached_persons.append((frame, cap_time, persons))

    pass_num = 0
    max_passes = 5

    while pass_num < max_passes:
        pass_num += 1
        learned_this_pass = 0

        logger.info(f"  [Pass {pass_num}] Embeddings: {len(engine.known_embeddings)}")

        all_results = []
        for frame, cap_time, persons in cached_persons:
            # Re-run only face detection on cached person crops
            engine._last_persons = persons
            if engine.person_detector and persons:
                face_results = []
                for person in persons:
                    crop = person['crop']
                    offset_x, offset_y = person['crop_offset']
                    try:
                        faces = engine.app.get(crop)
                    except Exception:
                        continue
                    for face in faces:
                        bbox = face.bbox.astype(int)
                        fx1, fy1, fx2, fy2 = bbox
                        fx1_full = fx1 + offset_x
                        fy1_full = fy1 + offset_y
                        w = (fx2 + offset_x) - fx1_full
                        h = (fy2 + offset_y) - fy1_full
                        if w < 15 or h < 15:
                            continue
                        embedding = face.normed_embedding
                        det_conf = float(face.det_score)
                        name = "Stranger"
                        best_score = 0.0
                        person_best = {}
                        for kn, ke in engine.known_embeddings:
                            sim = float(np.dot(ke, embedding))
                            if kn not in person_best or sim > person_best[kn]:
                                person_best[kn] = sim
                        for pn, ps in person_best.items():
                            if ps > best_score:
                                best_score = ps
                                if ps >= engine.confidence_threshold:
                                    name = pn
                        face_results.append({
                            'x': fx1_full, 'y': fy1_full, 'w': w, 'h': h,
                            'name': name, 'score': best_score,
                            'embedding': embedding,
                            'det_score': det_conf,
                            'person_conf': person['conf'],
                        })
                face_results = engine._deduplicate_faces(face_results)
            else:
                face_results = engine.analyze_frame(frame)

            all_results.append((frame, cap_time, face_results, list(persons)))

            # Auto-learn known faces
            for r in face_results:
                if r['name'] != "Stranger":
                    new_entry = auto_learn_face(
                        frame, r, known_faces_dir, engine
                    )
                    if new_entry:
                        session_stats['auto_learned'] += 1
                        learned_this_pass += 1

        # Log pass results
        for frame, cap_time, face_results, person_boxes in all_results:
            n_persons = len(person_boxes) if person_boxes else 0
            if face_results:
                details = [f"{r['name']}({r['score']:.2f})" for r in face_results]
                logger.info(f"    {cap_time.strftime('%H:%M:%S')}: "
                      f"{n_persons} person(s), {', '.join(details)}")
            else:
                logger.info(f"    {cap_time.strftime('%H:%M:%S')}: "
                      f"{n_persons} person(s), no faces")

        logger.info(f"  [Pass {pass_num}] Learned {learned_this_pass} new embedding(s)")

        if learned_this_pass == 0:
            break

        logger.info(f"  [Pass {pass_num}] Re-analysing with updated embeddings...")

    # ── Proximity reclassification ──────────────────────────────
    # If a Stranger is at a similar position to a known person in
    # another frame of the same batch, AND the embeddings have some
    # minimum similarity, reclassify as that person.
    # This handles angle changes (e.g. frontal → looking down).
    proximity_px = 150       # Max pixel distance to consider "same position"
    proximity_min_sim = 0.20 # Lowered from 0.35 to catch angle changes at same position

    # Collect all known person positions across the batch
    known_positions = []  # (name, cx, cy, embedding)
    for frame, cap_time, face_results, person_boxes in all_results:
        for r in face_results:
            if r['name'] != "Stranger":
                cx = r['x'] + r['w'] // 2
                cy = r['y'] + r['h'] // 2
                known_positions.append((r['name'], cx, cy, r['embedding']))

    # Reclassify strangers that are near known positions AND have some similarity
    for frame, cap_time, face_results, person_boxes in all_results:
        for r in face_results:
            if r['name'] == "Stranger" and known_positions:
                cx = r['x'] + r['w'] // 2
                cy = r['y'] + r['h'] // 2
                best_match = None
                best_dist = float('inf')
                best_emb_sim = 0.0
                for kname, kx, ky, kemb in known_positions:
                    dist = ((cx - kx) ** 2 + (cy - ky) ** 2) ** 0.5
                    emb_sim = float(np.dot(kemb, r['embedding']))
                    if dist < best_dist:
                        best_dist = dist
                        best_emb_sim = emb_sim
                        best_match = kname
                if (best_match and best_dist <= proximity_px
                        and best_emb_sim >= proximity_min_sim):
                    logger.info(f"    [Proximity] Reclassified Stranger -> "
                          f"{best_match} (dist={best_dist:.0f}px, "
                          f"sim={best_emb_sim:.3f})")
                    r['name'] = best_match

    # ── Re-verification pass ──────────────────────────────────────
    # After all learning passes and proximity reclassification,
    # re-check every detection against the latest embeddings to catch:
    #   1. False known: a face labelled as known but score is now below threshold
    #   2. False stranger: a stranger that now matches a known person
    reverify_threshold = engine.confidence_threshold
    reclassified_count = 0

    for frame, cap_time, face_results, person_boxes in all_results:
        for r in face_results:
            embedding = r['embedding']

            # Re-score against all current known embeddings
            person_best = {}
            for kn, ke in engine.known_embeddings:
                sim = float(np.dot(ke, embedding))
                if kn not in person_best or sim > person_best[kn]:
                    person_best[kn] = sim

            best_name = None
            best_score = 0.0
            for pn, ps in person_best.items():
                if ps > best_score:
                    best_score = ps
                    if ps >= reverify_threshold:
                        best_name = pn

            old_name = r['name']

            if old_name != "Stranger" and best_name is None:
                # Was labelled known, but no longer meets threshold → demote
                logger.info(f"    [Re-verify] {old_name} -> Stranger "
                      f"(best_score={best_score:.3f} < {reverify_threshold})")
                r['name'] = "Stranger"
                r['score'] = best_score
                reclassified_count += 1
            elif old_name == "Stranger" and best_name is not None:
                # Was stranger, but now matches a known person → promote
                logger.info(f"    [Re-verify] Stranger -> {best_name} "
                      f"(score={best_score:.3f})")
                r['name'] = best_name
                r['score'] = best_score
                reclassified_count += 1
            elif old_name != "Stranger" and best_name is not None and old_name != best_name:
                # Was labelled as wrong person → correct
                logger.info(f"    [Re-verify] {old_name} -> {best_name} "
                      f"(score={best_score:.3f})")
                r['name'] = best_name
                r['score'] = best_score
                reclassified_count += 1

    if reclassified_count > 0:
        logger.info(f"  [Re-verify] Reclassified {reclassified_count} detection(s)")
    else:
        logger.info(f"  [Re-verify] All detections confirmed")

    # ── Final results ────────────────────────────────────────────
    logger.info(f"\n  [Final Results]")
    unique_known = set()
    unique_strangers = 0
    batch_has_stranger = False
    batch_stranger_frame = None
    batch_stranger_results = None

    for frame, cap_time, face_results, person_boxes in all_results:
        session_stats['frames_analysed'] += 1
        if face_results:
            session_stats['frames_with_faces'] += 1
        session_stats['total_faces'] += len(face_results)

        ts_str = cap_time.strftime('%H:%M:%S')
        for r in face_results:
            if r['name'] == "Stranger":
                session_stats['total_strangers'] += 1
                unique_strangers = 1
                # Assign unique stranger ID and collect crop
                sid = assign_stranger_id(r, session_stats)
                collect_face_crop(frame, r, session_stats, stranger_id=sid)
                # Update name to include stranger ID (for display/events)
                r['name'] = f"Stranger_{sid}"
                # Track appearance timestamps for strangers
                ts_list = session_stats.get('person_timestamps', {})
                ts_list.setdefault(r['name'], [])
                if not ts_list[r['name']] or ts_list[r['name']][-1] != ts_str:
                    ts_list[r['name']].append(ts_str)
                session_stats['person_timestamps'] = ts_list
            else:
                session_stats['total_known'] += 1
                unique_known.add(r['name'])
                session_stats['known_persons'][r['name']] = \
                    session_stats['known_persons'].get(r['name'], 0) + 1
                # Collect best crop for known person
                collect_face_crop(frame, r, session_stats)
                # Track appearance timestamps for known persons
                ts_list = session_stats.get('person_timestamps', {})
                ts_list.setdefault(r['name'], [])
                if not ts_list[r['name']] or ts_list[r['name']][-1] != ts_str:
                    ts_list[r['name']].append(ts_str)
                session_stats['person_timestamps'] = ts_list

        # Annotate frame (for dashboard callback / SSE)
        annotated = annotate_frame(frame, face_results, camera_name,
                                   person_boxes=person_boxes)
        # Only save to disk if save_captures is enabled
        if save_captures:
            capture_filename = f"{safe_name}_{cap_time.strftime('%Y%m%d_%H%M%S')}.jpg"
            capture_path = os.path.join(camera_captures_dir, capture_filename)
            cv2.imwrite(capture_path, annotated)

        # Dashboard callback for live updates
        if on_frame_analysed:
            on_frame_analysed(annotated, face_results, cap_time,
                              person_boxes=person_boxes)

        # Track stranger for ONE alert per batch (not per frame)
        if any(r['name'].startswith("Stranger") for r in face_results):
            if not batch_has_stranger:
                batch_has_stranger = True
                batch_stranger_frame = annotated
                batch_stranger_results = face_results

    # Log ONE stranger alert per batch (not per frame, not per pass)
    if batch_has_stranger and batch_stranger_frame is not None and save_captures:
        log_stranger_alert(batch_stranger_frame, batch_stranger_results,
                           camera_name, alert_dir, alerts_list)

    # Merge strangers that accumulated enough embeddings to match
    merge_strangers(session_stats)

    session_stats['total_embeddings'] = len(engine.known_embeddings)

    known_list = ', '.join(sorted(unique_known)) if unique_known else 'None'
    logger.info(f"  Known:    {len(unique_known)} person(s) [{known_list}]")
    logger.info(f"  Unknown:  {unique_strangers} person(s)")
    logger.info(f"  Auto-learned: {session_stats['auto_learned']} | "
          f"Embeddings: {len(engine.known_embeddings)}")


# ── Camera Loop ────────────────────────────────────────────────────────────────

def run_camera(camera_config, face_recognition_config, alert_config,
               capture_config, engine, stop_event, session_stats):
    """
    Main loop for a single camera.
    Phase 1: Capture frames every N seconds
    Phase 2: Every M captures, analyse the batch
    """
    camera_name = camera_config.get('name', 'Camera')
    rtsp_url = camera_config['url']
    alert_dir = alert_config.get('alert_dir', './alerts')
    captures_dir = capture_config.get('captures_dir', './captures')
    capture_interval = face_recognition_config.get('capture_interval', 30)
    analyse_every = face_recognition_config.get('analyse_every', 5)
    known_faces_dir = face_recognition_config.get('known_faces_dir', './known_faces')

    os.makedirs(alert_dir, exist_ok=True)

    safe_name = camera_name.replace(' ', '_').lower()
    camera_captures_dir = os.path.join(captures_dir, safe_name)
    os.makedirs(camera_captures_dir, exist_ok=True)

    alerts_list = []
    capture_count = 0
    batch_frames = []
    batch_timestamps = []

    pipeline = "YOLO+SCRFD" if engine.person_detector else "SCRFD"
    logger.info(f"[{camera_name}] Pipeline: {pipeline}")
    logger.info(f"[{camera_name}] Capture every {capture_interval}s, "
          f"analyse every {analyse_every} captures")
    logger.info(f"[{camera_name}] Recognition threshold: {engine.confidence_threshold}")
    logger.info(f"[{camera_name}] Captures saved to: {camera_captures_dir}")

    while not stop_event.is_set():
        capture_count += 1
        now = datetime.now()
        timestamp = now.strftime("%H:%M:%S")

        frame = capture_frame(rtsp_url, camera_name)

        if frame is None:
            logger.error(f"[{camera_name}] Capture #{capture_count} at {timestamp} - FAILED")
            stop_event.wait(capture_interval)
            continue

        batch_frames.append(frame)
        batch_timestamps.append(now)
        session_stats['total_captures'] += 1

        logger.info(f"[{camera_name}] Capture #{capture_count} at {timestamp} - OK "
              f"({len(batch_frames)}/{analyse_every})")

        if len(batch_frames) >= analyse_every:
            analyse_batch(
                batch_frames, batch_timestamps, engine,
                known_faces_dir, camera_name,
                captures_dir, alert_dir, alerts_list, session_stats
            )
            batch_frames = []
            batch_timestamps = []

        stop_event.wait(capture_interval)

    # Analyse remaining frames
    if batch_frames:
        logger.info(f"\n[{camera_name}] Analysing remaining {len(batch_frames)} frame(s)...")
        analyse_batch(
            batch_frames, batch_timestamps, engine,
            known_faces_dir, camera_name,
            captures_dir, alert_dir, alerts_list, session_stats
        )

    logger.info(f"[{camera_name}] Stopped. Total captures: {capture_count}")


# ── Main Entry Point (Standalone Mode) ────────────────────────────────────────

def main():
    """Standalone entry point — reads config.py, runs FaceRecognizer."""
    import sys
    sys.path.insert(0, '.')

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(name)s] %(message)s',
        datefmt='%H:%M:%S',
    )

    YOLO_CONFIG = None
    SUMMARY_CONFIG = {}
    CAPTURE_CONFIG = {'captures_dir': './captures'}
    ALERT_CONFIG = {'alert_dir': './alerts'}

    try:
        from config import CAMERAS, FACE_RECOGNITION_CONFIG
        try:
            from config import ALERT_CONFIG as _ac
            ALERT_CONFIG = _ac
        except ImportError:
            pass
        try:
            from config import CAPTURE_CONFIG as _cc
            CAPTURE_CONFIG = _cc
        except ImportError:
            pass
        try:
            from config import YOLO_CONFIG as _yc
            YOLO_CONFIG = _yc
        except ImportError:
            pass
        try:
            from config import SUMMARY_CONFIG as _sc
            SUMMARY_CONFIG = _sc
        except ImportError:
            pass
    except ImportError:
        try:
            from config import RTSP_CONFIG, FACE_RECOGNITION_CONFIG
            CAMERAS = [{'name': 'Camera 1', 'url': RTSP_CONFIG['url'], 'enabled': True}]
        except ImportError:
            logger.error("config.py not found or missing required settings.")
            return

    enabled_cameras = [c for c in CAMERAS if c.get('enabled', True)]
    if not enabled_cameras:
        logger.error("No enabled cameras in config.py.")
        return

    known_faces_dir = FACE_RECOGNITION_CONFIG.get('known_faces_dir')
    capture_interval = FACE_RECOGNITION_CONFIG.get('capture_interval', 30)
    analyse_every = FACE_RECOGNITION_CONFIG.get('analyse_every', 5)
    confidence_threshold = FACE_RECOGNITION_CONFIG.get('confidence_threshold', 0.20)
    det_size = FACE_RECOGNITION_CONFIG.get('det_size', (640, 640))
    captures_dir = CAPTURE_CONFIG.get('captures_dir', './captures')

    models = {}
    if YOLO_CONFIG and 'model_path' in YOLO_CONFIG:
        models['yolo'] = YOLO_CONFIG['model_path']
        models['yolo_imgsz'] = YOLO_CONFIG.get('imgsz', 1280)
        models['yolo_person_conf'] = YOLO_CONFIG.get('person_conf', 0.30)
        models['yolo_crop_padding'] = YOLO_CONFIG.get('crop_padding', 0.3)
        models['yolo_min_person_height'] = YOLO_CONFIG.get('min_person_height', 80)

    logger.info("=" * 60)
    logger.info("AI Face Recognition Engine (Two-Stage: YOLO + InsightFace)")
    logger.info("=" * 60)

    fr = FaceRecognizer(
        cameras=enabled_cameras,
        known_faces=known_faces_dir,
        models=models,
        confidence_threshold=confidence_threshold,
        capture_interval=capture_interval,
        analyse_every=analyse_every,
        det_size=det_size,
        output_dir=captures_dir,
    )

    pipeline = "YOLO+SCRFD" if YOLO_CONFIG else "SCRFD"
    logger.info("Starting AI face recognition on %d camera(s)", len(enabled_cameras))
    logger.info("Pipeline: %s", pipeline)
    logger.info("Capture: every %ds | Analyse: every %d captures (%ds)",
                capture_interval, analyse_every, capture_interval * analyse_every)
    logger.info("Recognition threshold: %s", confidence_threshold)
    logger.info("Press Ctrl+C to stop and see summary report")
    logger.info("=" * 60)

    fr.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("\n\nStopping all cameras...")

    summary = fr.stop()

    # Also generate legacy console + HTML summary for standalone mode
    legacy_stats = fr._session.as_legacy_dict()
    print_summary(legacy_stats, captures_dir=captures_dir,
                  summary_config=SUMMARY_CONFIG)


if __name__ == "__main__":
    main()

"""Flutter enrollment API — stateless, no CCTV worker dependency.

All endpoints work whether or not CAMERA_WORKER_ENABLED is set.
The Flutter app handles camera capture; we only do InsightFace processing
and known_faces/ storage.

Endpoints:
    POST   /api/enroll/analyze              Validate a photo, return crop
    POST   /api/enroll/save                 Save crops for a person
    GET    /api/enroll/person/<name>        List images for a person
    DELETE /api/enroll/person/<name>/<file> Delete one image
"""

from flask import Blueprint, current_app, jsonify, request

from .auth import login_required

bp = Blueprint('enrollment', __name__)


@bp.route('/api/enroll/analyze', methods=['POST'])
@login_required
def analyze():
    """Accept a JPEG photo, detect and validate the face, return a crop.

    Request:  multipart/form-data  { photo: <file> }
    Response: {accepted, crop_b64, quality, face_w, face_h}
              or {error} with HTTP 422
    """
    from ..services.enrollment_service import EnrollmentService

    photo = request.files.get('photo')
    if not photo:
        return jsonify({'error': 'photo file required'}), 400

    image_bytes = photo.read()
    if not image_bytes:
        return jsonify({'error': 'Empty file'}), 400

    result = EnrollmentService.analyze_photo(image_bytes)

    if 'error' in result:
        return jsonify(result), 422

    return jsonify(result)


@bp.route('/api/enroll/save', methods=['POST'])
@login_required
def save():
    """Save validated face crops for a person and hot-reload the engine.

    Request JSON:
        {
            "name":  "Tan Ah Kow",
            "crops": ["<base64_jpeg>", ...]   // 1–8 items
        }

    Response: {status, person, saved, embeddings}
    """
    from ..services.enrollment_service import EnrollmentService

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    crops = data.get('crops', [])
    if not crops:
        return jsonify({'error': 'at least one crop required'}), 400
    if len(crops) > 8:
        return jsonify({'error': 'maximum 8 crops per enrollment'}), 400

    data_dir = current_app.config['FACE_DATA_DIR']
    result = EnrollmentService.save_enrollment(name, crops, data_dir)

    if 'error' in result:
        return jsonify(result), 422

    return jsonify(result)


@bp.route('/api/enroll/person/<name>', methods=['GET'])
@login_required
def list_person_images(name):
    """List all face images stored for a person.

    Response: [{filename, is_auto, mtime}, ...]
    """
    from ..services.enrollment_service import EnrollmentService

    data_dir = current_app.config['FACE_DATA_DIR']
    images = EnrollmentService.list_person_images(name, data_dir)
    return jsonify(images)


@bp.route('/api/enroll/person/<name>/<path:filename>', methods=['DELETE'])
@login_required
def delete_person_image(name, filename):
    """Delete a specific face image and hot-reload the engine."""
    from ..services.enrollment_service import EnrollmentService

    data_dir = current_app.config['FACE_DATA_DIR']
    result = EnrollmentService.delete_image(filename, data_dir)

    if 'error' in result:
        return jsonify(result), 404

    return jsonify(result)

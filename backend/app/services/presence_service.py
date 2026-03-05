"""Map face recognition results to SeniorPresence records."""

from datetime import datetime, timezone

from ..models.senior import Senior, SeniorPresence


class PresenceService:

    @staticmethod
    def update_from_face_results(face_results, camera, session):
        """Match face names to Senior records, update SeniorPresence."""
        now = datetime.now(timezone.utc)
        room = camera.room

        for result in face_results:
            if result['name'] == 'Stranger':
                presence = SeniorPresence(
                    senior_id=None,
                    room_id=room.id if room else None,
                    camera_id=camera.id,
                    arrived_at=now,
                    last_seen_at=now,
                    status='unidentified',
                    is_current=True,
                )
                session.add(presence)
            else:
                senior = Senior.query.filter_by(
                    name=result['name'], is_active=True).first()
                if not senior:
                    # Auto-create Senior for known faces (e.g. Odoo-synced)
                    senior = Senior(
                        name=result['name'],
                        nric_last4='----',
                        is_active=True,
                    )
                    session.add(senior)
                    session.flush()  # get senior.id
                if senior:
                    existing = SeniorPresence.query.filter_by(
                        senior_id=senior.id,
                        is_current=True,
                    ).first()
                    new_room_id = room.id if room else None
                    if existing:
                        if new_room_id and existing.room_id != new_room_id:
                            # Room changed — close old presence, start new one
                            existing.last_seen_at = now
                            existing.is_current = False
                            presence = SeniorPresence(
                                senior_id=senior.id,
                                room_id=new_room_id,
                                camera_id=camera.id,
                                arrived_at=now,
                                last_seen_at=now,
                                status='identified',
                                is_current=True,
                            )
                            session.add(presence)
                        else:
                            # Same room — just update last_seen
                            existing.last_seen_at = now
                    else:
                        presence = SeniorPresence(
                            senior_id=senior.id,
                            room_id=new_room_id,
                            camera_id=camera.id,
                            arrived_at=now,
                            last_seen_at=now,
                            status='identified',
                            is_current=True,
                        )
                        session.add(presence)

        # Update room occupancy
        if room:
            count = SeniorPresence.query.filter_by(
                room_id=room.id, is_current=True).count()
            room.current_occupancy = count

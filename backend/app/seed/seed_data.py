"""Seed the database with stub data matching the wireframe."""

from datetime import date, datetime, timedelta, timezone

from ..extensions import db
from ..models.senior import Senior, SeniorPresence
from ..models.room import Room
from ..models.activity import Activity
from ..models.alert import Alert
from ..models.locker import Locker
from ..models.kiosk_event import KioskEvent
from ..models.camera import Camera, CCTVSnapshot


def _today_at(hour, minute=0):
    """Return a datetime for today at the given time."""
    return datetime.combine(date.today(), datetime.min.time()).replace(
        hour=hour, minute=minute)


def run_seed(force=False):
    if force:
        db.drop_all()
        db.create_all()

    # Skip if data already exists
    if Senior.query.first() is not None and not force:
        print('Data already exists. Use --force to reseed.')
        return

    # ── Cameras ──────────────────────────────────────────────────
    cameras = [
        Camera(
            name='CAM 1 — Hall',
            rtsp_url='rtsp://admin:Admin12345@192.168.88.14:554/'
                     'cam/realmonitor?channel=3&subtype=0',
            channel=3,
            location='Multi-purpose Hall',
            enabled=True,
        ),
        Camera(
            name='CAM 2 — Room A',
            rtsp_url='rtsp://admin:Admin12345@192.168.88.14:554/'
                     'cam/realmonitor?channel=2&subtype=0',
            channel=2,
            location='Activity Room A',
            enabled=False,
        ),
        Camera(
            name='CAM 3 — Room B',
            rtsp_url=None,
            channel=None,
            location='Activity Room B',
            enabled=False,
        ),
        Camera(
            name='CAM 4 — Lobby',
            rtsp_url=None,
            channel=None,
            location='Lobby',
            enabled=False,
        ),
    ]
    db.session.add_all(cameras)
    db.session.flush()

    # ── Rooms ────────────────────────────────────────────────────
    rooms = [
        Room(name='Multi-purpose Hall',
             max_capacity=15, current_occupancy=12),
        Room(name='Activity Room A',
             max_capacity=10, current_occupancy=6),
        Room(name='Activity Room B',
             max_capacity=10, current_occupancy=3),
        Room(name='Kitchen Area',
             max_capacity=6, current_occupancy=2),
        Room(name='Reading Corner',
             max_capacity=8, current_occupancy=0),
        Room(name='Quiet Room',
             max_capacity=4, current_occupancy=0),
    ]
    db.session.add_all(rooms)
    db.session.flush()

    # Link cameras to rooms
    cameras[0].room_id = rooms[0].id  # Hall
    cameras[1].room_id = rooms[1].id  # Room A
    cameras[2].room_id = rooms[2].id  # Room B
    db.session.add_all(rooms)
    db.session.flush()

    # ── Seniors ──────────────────────────────────────────────────
    seniors_data = [
        ('Lim Teck Hwa', '4521A'),
        ('Chen Tao Lin', '8832B'),
        ('R. Subramaniam', '1190C'),
        ('Wong Ah Kow', '6673D'),
        ('Tan Mei Ling', '2241A'),
        ('Joseph Tay', '7812B'),
        ('Khant Zaw Win', '3345C'),
        ('Mdm Ong Siew Lan', '5590D'),
        ('Mr Goh Beng Huat', '2278A'),
        ('Fatimah Bte Ahmad', '1123B'),
        ('Lee Kah Wai', '4456C'),
        ('Mdm Siti Aminah', '7789D'),
        ('Tan Ah Lian', '3312A'),
        ('K. Rajendran', '6645B'),
        ('Ng Sook Chin', '9978C'),
        ('Mdm Chua Bee Leng', '2201D'),
        ('Mr Yeo Kok Seng', '5534A'),
        ('Halimah Bte Ismail', '8867B'),
        ('Lim Ah Huey', '1100C'),
        ('Mr Chan Keng Soon', '4433D'),
        ('Mdm Low Poh Lian', '7766A'),
        ('A. Muthu', '2099B'),
        ('Mdm Ho Siew Keng', '5532C'),
        ('Mr Toh Kim Hock', '8865D'),
        ('Mdm Chng Geok Eng', '1198A'),
    ]
    seniors = []
    for name, nric in seniors_data:
        s = Senior(name=name, nric_last4=nric)
        seniors.append(s)
    db.session.add_all(seniors)
    db.session.flush()

    # ── Senior Presences (23 present today) ──────────────────────
    # Distribute across rooms matching wireframe heatmap
    presence_assignments = [
        # Multi-purpose Hall: 12 seniors
        (0, 0, '08:45'), (2, 0, '09:10'), (5, 0, '09:15'),
        (8, 0, '09:20'), (9, 0, '09:25'), (10, 0, '09:30'),
        (11, 0, '09:35'), (12, 0, '09:40'), (13, 0, '09:45'),
        (14, 0, '09:50'), (15, 0, '10:00'), (16, 0, '10:05'),
        # Activity Room A: 6 seniors
        (1, 1, '09:02'), (6, 1, '09:08'), (17, 1, '09:12'),
        (18, 1, '09:18'), (19, 1, '09:22'), (20, 1, '09:28'),
        # Activity Room B: 3 seniors
        (3, 2, '09:48'), (7, 2, '09:55'), (21, 2, '10:02'),
        # Kitchen Area: 2 seniors
        (4, 3, '10:05'), (22, 3, '10:10'),
    ]

    presences = []
    for senior_idx, room_idx, time_str in presence_assignments:
        h, m = map(int, time_str.split(':'))
        arrived = _today_at(h, m)
        p = SeniorPresence(
            senior_id=seniors[senior_idx].id,
            room_id=rooms[room_idx].id,
            camera_id=cameras[room_idx].id if room_idx < len(cameras) else None,
            arrived_at=arrived,
            last_seen_at=arrived + timedelta(minutes=15),
            status='identified',
            is_current=True,
        )
        presences.append(p)

    # 2 unidentified presences (strangers)
    presences.append(SeniorPresence(
        senior_id=None,
        room_id=rooms[0].id,  # Multi-purpose Hall
        camera_id=cameras[0].id,
        arrived_at=_today_at(9, 35),
        last_seen_at=_today_at(10, 30),
        status='unidentified',
        is_current=True,
    ))
    presences.append(SeniorPresence(
        senior_id=None,
        room_id=rooms[3].id,  # Lobby via CAM 4
        camera_id=cameras[3].id,
        arrived_at=_today_at(10, 15),
        last_seen_at=_today_at(10, 30),
        status='unidentified',
        is_current=True,
    ))

    db.session.add_all(presences)
    db.session.flush()

    # ── Activities ───────────────────────────────────────────────
    activities = [
        Activity(
            name='Morning Tai Chi',
            room_id=rooms[0].id,
            scheduled_time=_today_at(8, 30),
            end_time=_today_at(9, 30),
            status='done',
            attendee_count=12,
        ),
        Activity(
            name='Art & Craft Session',
            room_id=rooms[1].id,
            scheduled_time=_today_at(9, 30),
            end_time=_today_at(11, 0),
            status='done',
            attendee_count=6,
        ),
        Activity(
            name='Cognitive Games',
            room_id=rooms[0].id,
            scheduled_time=_today_at(10, 30),
            end_time=_today_at(12, 0),
            status='active',
            attendee_count=10,
        ),
        Activity(
            name='Cooking Class',
            room_id=rooms[3].id,
            scheduled_time=_today_at(14, 0),
            end_time=_today_at(15, 30),
            status='upcoming',
            attendee_count=0,
        ),
        Activity(
            name='Community Singing',
            room_id=rooms[0].id,
            scheduled_time=_today_at(15, 30),
            end_time=_today_at(17, 0),
            status='upcoming',
            attendee_count=0,
        ),
    ]
    db.session.add_all(activities)
    db.session.flush()

    # ── Alerts ───────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    alerts = [
        Alert(
            type='critical',
            title='Loud Voice Detected',
            description='Audio spike in Multi-purpose Hall. '
                        'Possible argument or distress call.',
            camera_id=cameras[0].id,
            created_at=now - timedelta(minutes=2),
        ),
        Alert(
            type='warning',
            title='Unidentified Person in Lobby',
            description='Person entered with a group but was not '
                        'recognised by facial system.',
            camera_id=cameras[3].id,
            created_at=now - timedelta(minutes=18),
        ),
        Alert(
            type='info',
            title='Multi-purpose Hall Near Capacity',
            description='12 of 15 seats occupied. '
                        'Consider redirecting new arrivals.',
            camera_id=cameras[0].id,
            created_at=now - timedelta(minutes=25),
        ),
    ]
    db.session.add_all(alerts)

    # ── Lockers ──────────────────────────────────────────────────
    lockers = [
        Locker(locker_number='L01', status='in_use',
               assigned_to=seniors[2].id,
               equipment_description='Yoga mats'),
        Locker(locker_number='L02', status='in_use',
               assigned_to=seniors[1].id,
               equipment_description='Art supplies'),
        Locker(locker_number='L03', status='available'),
        Locker(locker_number='L04', status='in_use',
               assigned_to=seniors[3].id,
               equipment_description='Board games'),
        Locker(locker_number='L05', status='available'),
        Locker(locker_number='L06', status='available'),
        Locker(locker_number='L07', status='available'),
        Locker(locker_number='L08', status='reserved',
               equipment_description='Cooking Class supplies'),
        Locker(locker_number='L09', status='available'),
        Locker(locker_number='L10', status='available'),
    ]
    db.session.add_all(lockers)
    db.session.flush()

    # ── Kiosk Events ─────────────────────────────────────────────
    kiosk_events = [
        KioskEvent(
            senior_id=seniors[0].id, event_type='check_in',
            activity_id=activities[0].id,
            timestamp=_today_at(8, 44)),
        KioskEvent(
            senior_id=seniors[1].id, event_type='check_in',
            activity_id=activities[1].id,
            timestamp=_today_at(9, 1)),
        KioskEvent(
            senior_id=seniors[2].id, event_type='check_in',
            activity_id=activities[0].id,
            timestamp=_today_at(9, 9)),
        KioskEvent(
            senior_id=seniors[2].id, event_type='locker_open',
            locker_id=lockers[0].id,
            timestamp=_today_at(10, 32)),
        KioskEvent(
            senior_id=seniors[3].id, event_type='check_in',
            activity_id=activities[2].id,
            timestamp=_today_at(10, 28)),
        KioskEvent(
            senior_id=seniors[4].id, event_type='check_in',
            activity_id=activities[2].id,
            timestamp=_today_at(10, 30)),
        KioskEvent(
            senior_id=seniors[5].id, event_type='check_in',
            activity_id=activities[0].id,
            timestamp=_today_at(8, 40)),
        KioskEvent(
            senior_id=seniors[1].id, event_type='locker_open',
            locker_id=lockers[1].id,
            timestamp=_today_at(9, 3)),
        KioskEvent(
            senior_id=seniors[3].id, event_type='locker_open',
            locker_id=lockers[3].id,
            timestamp=_today_at(10, 29)),
    ]
    db.session.add_all(kiosk_events)

    # ── CCTV Snapshots (stub placeholders) ───────────────────────
    for cam in cameras:
        snap = CCTVSnapshot(
            camera_id=cam.id,
            identified_count=10 if cam.id == cameras[0].id else (
                6 if cam.id == cameras[1].id else (
                    3 if cam.id == cameras[2].id else 0)),
            unidentified_count=2 if cam.id == cameras[0].id else (
                0 if cam.id == cameras[1].id else (
                    0 if cam.id == cameras[2].id else 1)),
            snapshot_b64=None,
            timestamp=now - timedelta(minutes=3),
        )
        db.session.add(snap)

    db.session.commit()
    print(f'Seeded: {len(seniors)} seniors, {len(rooms)} rooms, '
          f'{len(activities)} activities, {len(alerts)} alerts, '
          f'{len(lockers)} lockers, {len(kiosk_events)} kiosk events, '
          f'{len(cameras)} cameras')

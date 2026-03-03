"""Move room-camera relationship: add room_id to cameras, remove camera_id from rooms

Revision ID: a3f1b2c4d5e6
Revises: 0bb6997cd181
Create Date: 2026-03-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3f1b2c4d5e6'
down_revision = '0bb6997cd181'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add room_id column to cameras table
    with op.batch_alter_table('cameras') as batch_op:
        batch_op.add_column(
            sa.Column('room_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_cameras_room_id', 'rooms', ['room_id'], ['id'])

    # 2. Migrate data: copy room→camera links to camera→room
    conn = op.get_bind()
    rows = conn.execute(
        sa.text('SELECT id, camera_id FROM rooms WHERE camera_id IS NOT NULL')
    ).fetchall()
    for room_id, camera_id in rows:
        conn.execute(
            sa.text('UPDATE cameras SET room_id = :room_id WHERE id = :cam_id'),
            {'room_id': room_id, 'cam_id': camera_id},
        )

    # 3. Remove camera_id column from rooms table
    with op.batch_alter_table('rooms') as batch_op:
        batch_op.drop_column('camera_id')


def downgrade():
    # 1. Re-add camera_id to rooms
    with op.batch_alter_table('rooms') as batch_op:
        batch_op.add_column(
            sa.Column('camera_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_rooms_camera_id', 'cameras', ['camera_id'], ['id'])

    # 2. Migrate data back
    conn = op.get_bind()
    rows = conn.execute(
        sa.text('SELECT id, room_id FROM cameras WHERE room_id IS NOT NULL')
    ).fetchall()
    for cam_id, room_id in rows:
        conn.execute(
            sa.text('UPDATE rooms SET camera_id = :cam_id WHERE id = :room_id'),
            {'cam_id': cam_id, 'room_id': room_id},
        )

    # 3. Remove room_id from cameras
    with op.batch_alter_table('cameras') as batch_op:
        batch_op.drop_column('room_id')

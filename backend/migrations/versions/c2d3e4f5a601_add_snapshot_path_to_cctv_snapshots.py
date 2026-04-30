"""add snapshot_path to cctv_snapshots

Revision ID: c2d3e4f5a601
Revises: b1c2d3e4f501
Create Date: 2026-04-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c2d3e4f5a601'
down_revision = 'b1c2d3e4f501'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('cctv_snapshots', schema=None) as batch_op:
        batch_op.add_column(sa.Column('snapshot_path', sa.String(255), nullable=True))


def downgrade():
    with op.batch_alter_table('cctv_snapshots', schema=None) as batch_op:
        batch_op.drop_column('snapshot_path')

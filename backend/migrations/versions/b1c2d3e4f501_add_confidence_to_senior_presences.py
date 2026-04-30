"""add confidence to senior_presences

Revision ID: b1c2d3e4f501
Revises: fcc6ba130585
Create Date: 2026-04-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f501'
down_revision = ('fcc6ba130585', 'f04aa1c6bd60')
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('senior_presences', schema=None) as batch_op:
        batch_op.add_column(sa.Column('confidence', sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table('senior_presences', schema=None) as batch_op:
        batch_op.drop_column('confidence')

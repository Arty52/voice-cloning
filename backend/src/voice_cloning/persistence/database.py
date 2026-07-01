from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


SessionFactory = sessionmaker[Session]


def create_database_engine(database_url: str) -> Engine:
    resolved_url = database_url.strip()
    if not resolved_url:
        raise ValueError("DATABASE_URL is required to create a database engine.")
    return create_engine(resolved_url, pool_pre_ping=True)


def create_session_factory(engine: Engine) -> SessionFactory:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def unit_of_work(session_factory: SessionFactory) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

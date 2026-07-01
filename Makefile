# Local Voice Clone Lab

PYTHON ?= python3
VENV_DIR := .venv
VENV_PYTHON := $(VENV_DIR)/bin/python
DATABASE_URL ?= postgresql+psycopg://voice_cloning:voice_cloning@localhost:5432/voice_cloning

.PHONY: \
	setup install-backend install-backend-processing install-frontend \
	up down recycle destroy build logs ps \
	migrate test-postgres test-backend test-frontend test check \
	smoke-live clean-cache

setup: install-backend install-frontend

install-backend:
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_PYTHON) -m pip install --upgrade pip
	$(VENV_PYTHON) -m pip install -e "backend[dev]"

install-backend-processing: install-backend
	$(VENV_PYTHON) -m pip install -e "backend[dev,sample-processing]"

install-frontend:
	cd frontend && npm ci

up:
	docker compose up --build

down:
	docker compose down

recycle:
	docker compose down
	docker compose up --build

destroy:
	docker compose down -v --remove-orphans

build:
	docker compose build

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

migrate:
	cd backend && DATABASE_URL="$(DATABASE_URL)" ../$(VENV_PYTHON) -m alembic -c alembic.ini upgrade head

test-postgres:
	docker compose up -d db
	cd backend && DATABASE_URL="$(DATABASE_URL)" ../$(VENV_PYTHON) -m pytest -m postgres tests/test_persistence.py
	cd backend && DATABASE_URL="$(DATABASE_URL)" ../$(VENV_PYTHON) -m alembic -c alembic.ini check

test-backend:
	cd backend && ../$(VENV_PYTHON) -m pytest

test-frontend:
	cd frontend && npm run lint && npm run test:run && npm run build

test: test-backend test-frontend

check: test

smoke-live:
	docker compose exec api python /app/scripts/smoke_live.py

clean-cache:
	rm -f storage/voice-cache.json

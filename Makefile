# Local Voice Clone Lab

PYTHON ?= python3
VENV_DIR := .venv
VENV_PYTHON := $(VENV_DIR)/bin/python

.PHONY: \
	setup install-backend install-backend-processing install-frontend \
	up down recycle destroy build logs ps \
	test-backend test-frontend test check \
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

#!/bin/sh
# Creates a second, empty database on the SAME postgres-auth container —
# not a separate container — for auth-service's test suite.
#
# Runs via Postgres's own init-script convention: the official image executes
# every file under /docker-entrypoint-initdb.d/ (this one mounted in via
# docker-compose.yml) exactly once, the FIRST time the container starts against
# an EMPTY data directory. On an already-initialized volume (any developer's
# existing `pgdata_auth`) it will NOT run — create the database once by hand
# instead:
#   docker exec synapsedesk-postgres-auth createdb -U "$DB_USER" "$AUTH_TEST_DB_NAME"
# or, for a genuinely fresh setup, `docker compose down -v` before `up` — that
# DESTROYS the existing dev database, so never do it without meaning to.
#
# Same container as dev on purpose, same as apps/auth-service/.env's
# DATABASE_URL host:port — isolation here comes from the DATABASE NAME, not a
# separate server. `resetDatabase()` in the test suite TRUNCATEs every table
# before each test, so a suite pointed at the dev database by mistake is one
# typo away from deleting real data; a distinct name is what makes that typo
# loud (a connection to a nonexistent database) instead of silent.
#
# A .sql file can't reference $AUTH_TEST_DB_NAME — Postgres runs those verbatim
# through psql, with no environment substitution. This is a shell script
# specifically so the name has one source of truth (root .env) rather than
# being hardcoded a second time here.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE "$AUTH_TEST_DB_NAME";
EOSQL

-- docker/postgres-init-schemas.sql
-- Provisions the 8 SapoClone v2 service schemas and their isolated runtime roles
-- (<service>_app) with NOSUPERUSER and NOBYPASSRLS (ADR-0002, ADR-0011).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS insight;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS customer;

DO $$
DECLARE
  svc text;
  other_svc text;
  role_name text;
  services text[] := ARRAY[
    'platform',
    'catalog',
    'inventory',
    'sales',
    'customer',
    'finance',
    'integration',
    'insight'
  ];
BEGIN
  FOREACH svc IN ARRAY services LOOP
    role_name := svc || '_app';

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
        role_name,
        role_name
      );
    ELSE
      EXECUTE format(
        'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
        role_name,
        role_name
      );
    END IF;

    -- Revoke PUBLIC access on service schemas so roles cannot see other schemas via PUBLIC
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', svc);

    -- Explicitly revoke access on all other service schemas
    FOREACH other_svc IN ARRAY services LOOP
      IF other_svc <> svc THEN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', other_svc, role_name);
      END IF;
    END LOOP;

    -- Grant access strictly to the service's own schema
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', svc, role_name);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I',
      svc,
      role_name
    );
    EXECUTE format(
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I',
      svc,
      role_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      svc,
      role_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
      svc,
      role_name
    );
    EXECUTE format('ALTER ROLE %I SET search_path TO %I', role_name, svc);
  END LOOP;
END
$$;

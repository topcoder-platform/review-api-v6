-- Ensure the pg_trgm extension exists (some managed DBs install it in a non-public schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
  ) THEN
    CREATE EXTENSION pg_trgm;
  END IF;
END
$$;

-- Create a GIN trigram index on scorecard.name using the correct schema-qualified opclass
-- This resolves the schema where pg_trgm is installed (e.g., public, extensions, etc.)
DO $$
DECLARE
  trgm_schema text;
  idx_exists boolean;
  sql text;
BEGIN
  SELECT n.nspname
  INTO trgm_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF trgm_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension not installed and could not be created';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'scorecard_name_trgm_idx'
  ) INTO idx_exists;

  IF NOT idx_exists THEN
    -- Assume table is in current search_path; explicitly qualify table with public if needed in your env
    sql := format(
      'CREATE INDEX %I ON %I USING GIN (%I %s.gin_trgm_ops)',
      'scorecard_name_trgm_idx',
      'scorecard',
      'name',
      trgm_schema
    );
    EXECUTE sql;
  END IF;
END
$$;

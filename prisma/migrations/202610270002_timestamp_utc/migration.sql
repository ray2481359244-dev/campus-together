-- The installed adapter formats UTC dates without an offset, and normalizes
-- returned timestamptz offsets to +00:00. Preserve the dates previously exposed
-- by that adapter, then use UTC connections for all future ORM reads/writes.
-- On a database already using UTC this transformation is an identity.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
      AND table_name <> '_prisma_migrations'
  LOOP
    EXECUTE format('UPDATE %I SET %I = (%I AT TIME ZONE current_setting(''TimeZone'')) AT TIME ZONE ''UTC'' WHERE %I IS NOT NULL',
      item.table_name, item.column_name, item.column_name, item.column_name);
  END LOOP;
END $$;

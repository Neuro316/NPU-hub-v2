-- Helper functions for email daily stats

-- Upsert sent count
CREATE OR REPLACE FUNCTION upsert_email_daily_stats(
  p_org_id UUID,
  p_date DATE,
  p_sent INTEGER
) RETURNS VOID AS $$
BEGIN
  INSERT INTO org_email_daily_stats (org_id, date, sent_count)
  VALUES (p_org_id, p_date, p_sent)
  ON CONFLICT (org_id, date)
  DO UPDATE SET sent_count = org_email_daily_stats.sent_count + p_sent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment a specific stat field
CREATE OR REPLACE FUNCTION increment_email_stat(
  p_org_id UUID,
  p_date DATE,
  p_field TEXT
) RETURNS VOID AS $$
BEGIN
  -- Ensure row exists
  INSERT INTO org_email_daily_stats (org_id, date)
  VALUES (p_org_id, p_date)
  ON CONFLICT (org_id, date) DO NOTHING;

  -- Increment the field
  EXECUTE format(
    'UPDATE org_email_daily_stats SET %I = %I + 1 WHERE org_id = $1 AND date = $2',
    p_field, p_field
  ) USING p_org_id, p_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

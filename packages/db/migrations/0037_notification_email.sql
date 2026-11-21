-- Add notification_email to teams for dedicated alert delivery.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS notification_email text;

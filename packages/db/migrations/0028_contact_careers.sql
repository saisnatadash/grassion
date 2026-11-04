-- Add status + notes to contact_submissions so the admin panel can manage them.
ALTER TABLE contact_submissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notes  text;

CREATE INDEX IF NOT EXISTS contact_submissions_status_idx
  ON contact_submissions(status, created_at DESC);

-- Career applications (Supabase storage holds the resume; only the path is stored here).
CREATE TABLE IF NOT EXISTS career_applications (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text    NOT NULL,
  email           text    NOT NULL,
  role            text    NOT NULL,
  linkedin_url    text,
  github_url      text,
  portfolio_url   text,
  message         text    NOT NULL,
  resume_path     text,   -- path inside the 'career-resumes' Supabase bucket
  status          text    NOT NULL DEFAULT 'new',
  notes           text,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS career_apps_status_created_idx
  ON career_applications(status, created_at DESC);

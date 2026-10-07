-- Briefings diarios de Today: uno por fecha local, con la valoración del usuario.

create table briefings (
  date          text primary key check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  generated_at  timestamptz not null,
  content       jsonb not null,
  -- Duplicado de content.feedback.useful para medir el criterio 8/10.
  useful        boolean
);

alter table briefings enable row level security;

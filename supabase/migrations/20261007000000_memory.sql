-- Memoria con procedencia e historia. Fechas de origen (captured_at, version)
-- se guardan como texto para conservarlas exactamente como vienen de la nota.

create table memories (
  id          uuid primary key,
  key         text not null unique,
  domain      text not null,
  category    text not null check (category in ('goal', 'rule', 'decision', 'status', 'note', 'event')),
  epistemic   text not null check (epistemic in ('fact', 'inference', 'recommendation')),
  statement   text not null,
  status      text not null check (status in ('active', 'retracted', 'deleted')),
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  -- Una lápida no conserva texto.
  constraint deleted_has_no_text check (status <> 'deleted' or statement = '')
);

create index memories_domain_idx on memories (domain) where status = 'active';

create table memory_sources (
  memory_id     uuid not null references memories (id) on delete cascade,
  seq           integer not null check (seq >= 0),
  source_id     text not null,
  path          text not null,
  content_hash  text not null,
  version       text,
  captured_at   text not null,
  synthetic     boolean not null,
  anchor        text,
  primary key (memory_id, seq)
);

create index memory_sources_source_idx on memory_sources (source_id);

create table memory_revisions (
  memory_id          uuid not null references memories (id) on delete cascade,
  seq                integer not null check (seq >= 0),
  at                 timestamptz not null,
  by                 text not null check (by in ('import', 'user', 'system')),
  change             text not null check (change in ('create', 'update', 'correct', 'retract', 'delete', 'restore')),
  previous_statement text,
  reason             text,
  -- Copia de la fuente citada por la revisión; se purga al eliminar.
  source             jsonb,
  primary key (memory_id, seq)
);

-- Sin políticas: solo el rol de servicio (servidor) accede. Las políticas por
-- usuario y dominio llegan con la autenticación (fase 4).
alter table memories enable row level security;
alter table memory_sources enable row level security;
alter table memory_revisions enable row level security;

-- Búsqueda semántica: un embedding por memoria activa (derivado de su texto).

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table memory_embeddings (
  memory_id     uuid primary key references memories (id) on delete cascade,
  model         text not null,
  -- sha256 del texto embebido: si no coincide con el texto actual, está obsoleto.
  content_hash  text not null,
  embedding     extensions.vector(1536) not null,
  updated_at    timestamptz not null default now()
);

create index memory_embeddings_hnsw on memory_embeddings using hnsw (embedding extensions.vector_cosine_ops);

alter table memory_embeddings enable row level security;

-- Eliminar una memoria purga también su embedding, garantizado por la base de datos.
create function purge_deleted_embedding() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.memory_embeddings where memory_id = new.id;
  return new;
end;
$$;

create trigger memories_purge_embedding
  after update of status on memories
  for each row when (new.status = 'deleted')
  execute function purge_deleted_embedding();

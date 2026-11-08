-- Transactional outbox: only future transitions to paid enqueue a confirmation.
create table public.order_confirmation_emails (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','sending','sent','retry','failed','uncertain')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.order_confirmation_emails enable row level security;
revoke all on public.order_confirmation_emails from anon, authenticated;
grant select, update on public.order_confirmation_emails to service_role;
create index order_confirmation_email_queue_idx on public.order_confirmation_emails(next_attempt_at)
  where status in ('queued','retry');

create function public.enqueue_order_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    insert into public.order_confirmation_emails(order_id) values (new.id) on conflict (order_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger order_confirmation_on_payment after update of payment_status on public.orders
for each row execute function public.enqueue_order_confirmation();

create function public.claim_order_confirmation() returns setof public.order_confirmation_emails
language plpgsql security definer set search_path = '' as $$
begin
  -- A lost SMTP response or crashed sender cannot safely be retried automatically.
  update public.order_confirmation_emails set status = 'uncertain', last_error = 'Sender stopped before delivery could be recorded'
  where status = 'sending' and claimed_at < now() - interval '10 minutes';
  return query
  update public.order_confirmation_emails e set status = 'sending', attempts = attempts + 1,
    claimed_at = now(), claim_token = gen_random_uuid()
  where e.id = (
    select q.id from public.order_confirmation_emails q
    join public.orders o on o.id = q.order_id
    where q.status in ('queued','retry') and q.next_attempt_at <= now() and q.attempts < 5
      and o.payment_status = 'paid'
    order by q.next_attempt_at, q.id for update of q skip locked limit 1
  ) returning e.*;
end;
$$;
revoke all on function public.enqueue_order_confirmation() from public, anon, authenticated;
revoke all on function public.claim_order_confirmation() from public, anon, authenticated;
grant execute on function public.claim_order_confirmation() to service_role;

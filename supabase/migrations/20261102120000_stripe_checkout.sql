-- Stripe collects these fields after the pending order is created.
alter table public.orders alter column customer_name drop not null;
alter table public.orders alter column customer_email drop not null;
alter table public.orders alter column shipping_address drop not null;
alter table public.orders add column if not exists stripe_checkout_session_id text unique;
create unique index if not exists orders_stripe_checkout_session_id_idx
  on public.orders(stripe_checkout_session_id);

create or replace function public.sync_stripe_checkout(
  p_order_id uuid, p_session_id text, p_payment_id text,
  p_state text, p_total integer, p_currency text, p_customer jsonb, p_shipping jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.stripe_checkout_session_id is distinct from p_session_id then
    raise exception 'Checkout session mismatch';
  end if;
  if p_total is distinct from o.total or upper(p_currency) is distinct from o.currency then
    raise exception 'Checkout amount or currency mismatch';
  end if;
  if p_state not in ('paid', 'pending', 'failed', 'expired') then
    raise exception 'Invalid checkout state';
  end if;
  -- Locking and this guard make payment recording safe for concurrent retries.
  if o.payment_status in ('paid', 'refunded', 'partially_refunded') then return; end if;
  if p_state = 'pending' and (o.payment_status = 'failed' or o.status = 'cancelled') then return; end if;
  update public.orders set
    status = case when p_state = 'paid' then 'paid'
                  when p_state in ('failed', 'expired') then 'cancelled' else 'pending' end,
    payment_status = case when p_state = 'expired' then 'unpaid' else p_state end,
    customer_name = coalesce(p_shipping->>'name', p_customer->>'name', customer_name),
    customer_email = coalesce(p_customer->>'email', customer_email),
    customer_phone = coalesce(p_customer->>'phone', customer_phone),
    shipping_address = coalesce(p_shipping->'address', shipping_address)
  where id = p_order_id;
  if p_state = 'paid' then
    insert into public.payments (order_id, provider, provider_payment_id, amount, currency, status)
    values (p_order_id, 'stripe', coalesce(p_payment_id, p_session_id), p_total, upper(p_currency), 'succeeded');
  end if;
end;
$$;
revoke all on function public.sync_stripe_checkout(uuid,text,text,text,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sync_stripe_checkout(uuid,text,text,text,integer,text,jsonb,jsonb) to service_role;

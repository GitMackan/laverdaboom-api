-- stock_quantity remains physical stock; reserved_quantity is unavailable stock.
alter table public.product_variants
  add column reserved_quantity integer not null default 0,
  add constraint product_variants_reservation_bounds
    check (reserved_quantity >= 0 and reserved_quantity <= stock_quantity);

-- Existing orders are deliberately not reserved or deducted retroactively.
alter table public.orders add column inventory_status text not null default 'legacy'
  check (inventory_status in ('legacy', 'reserved', 'committed', 'released'));
create index orders_reserved_inventory_idx on public.orders(id) where inventory_status = 'reserved';

create table public.inventory_reservations (
  order_id uuid not null references public.orders(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  primary key (order_id, variant_id)
);
alter table public.inventory_reservations enable row level security;
revoke all on public.inventory_reservations from anon, authenticated;

create function public.reserve_order_inventory(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; item record; v public.product_variants;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.inventory_status = 'reserved' then return; end if;
  if o.inventory_status <> 'legacy' or o.status <> 'pending' or o.payment_status <> 'unpaid'
     or o.stripe_checkout_session_id is null then
    raise exception 'Order cannot reserve inventory';
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Order has no items';
  end if;
  -- Lock every variant in stable UUID order to avoid deadlocks across baskets.
  for item in select variant_id, sum(quantity)::integer as quantity,
                     min(unit_price) as min_price, max(unit_price) as max_price
              from public.order_items where order_id = p_order_id
              group by variant_id order by variant_id
  loop
    select * into v from public.product_variants where id = item.variant_id for update;
    if not found or not v.active or not exists (
      select 1 from public.products where id = v.product_id and active
    ) then raise exception using errcode = 'P0001', message = 'En produkt är inte längre tillgänglig.'; end if;
    if v.price <> item.min_price or v.price <> item.max_price then
      raise exception using errcode = 'P0001', message = 'Priset har ändrats. Uppdatera varukorgen och försök igen.';
    end if;
    if item.quantity > 99 then raise exception 'Invalid order quantity'; end if;
    if not v.made_to_order then
      if v.stock_quantity - v.reserved_quantity < item.quantity then
        raise exception using errcode = 'P0001', message = 'Otillräckligt lager. Uppdatera varukorgen och försök igen.';
      end if;
      update public.product_variants set reserved_quantity = reserved_quantity + item.quantity where id = v.id;
      insert into public.inventory_reservations(order_id, variant_id, quantity)
      values (p_order_id, v.id, item.quantity);
    end if;
  end loop;
  update public.orders set inventory_status = 'reserved' where id = p_order_id;
end;
$$;

-- Replace the previous payment transaction so stock and payment change atomically.
create or replace function public.sync_stripe_checkout(
  p_order_id uuid, p_session_id text, p_payment_id text,
  p_state text, p_total integer, p_currency text, p_customer jsonb, p_shipping jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; reservation record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.stripe_checkout_session_id is distinct from p_session_id then raise exception 'Checkout session mismatch'; end if;
  if p_total is distinct from o.total or upper(p_currency) is distinct from o.currency then
    raise exception 'Checkout amount or currency mismatch';
  end if;
  if p_state is null or p_state not in ('paid', 'pending', 'failed', 'expired') then raise exception 'Invalid checkout state'; end if;
  if o.payment_status in ('paid', 'refunded', 'partially_refunded') then return; end if;
  if p_state = 'pending' and (o.payment_status = 'failed' or o.status = 'cancelled') then return; end if;
  if p_state = 'paid' and o.inventory_status = 'released' then
    raise exception 'Paid session has released inventory; manual reconciliation required';
  end if;

  if o.inventory_status = 'reserved' and p_state in ('paid', 'failed', 'expired') then
    for reservation in select * from public.inventory_reservations where order_id = p_order_id order by variant_id
    loop
      update public.product_variants set
        reserved_quantity = reserved_quantity - reservation.quantity,
        stock_quantity = stock_quantity - case when p_state = 'paid' then reservation.quantity else 0 end
      where id = reservation.variant_id;
    end loop;
    update public.orders set inventory_status = case when p_state = 'paid' then 'committed' else 'released' end
    where id = p_order_id;
  end if;

  update public.orders set
    status = case when p_state = 'paid' then 'paid' when p_state in ('failed', 'expired') then 'cancelled' else 'pending' end,
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
revoke all on function public.reserve_order_inventory(uuid) from public, anon, authenticated;
grant execute on function public.reserve_order_inventory(uuid) to service_role;
revoke all on function public.sync_stripe_checkout(uuid,text,text,text,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sync_stripe_checkout(uuid,text,text,text,integer,text,jsonb,jsonb) to service_role;

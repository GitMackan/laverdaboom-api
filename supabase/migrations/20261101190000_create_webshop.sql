-- Laverdaboom webshop initial schema. Prices stored in minor units (SEK ore).
create table public.products (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) > 0),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 description text,
 category text not null check (category in ('leash','collar','other')),
 base_price integer not null check (base_price >= 0),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.product_variants (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 sku text unique,
 color text,
 length_cm integer check (length_cm is null or length_cm > 0),
 size text,
 price integer not null check (price >= 0),
 stock_quantity integer not null default 0 check (stock_quantity >= 0),
 made_to_order boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique (id, product_id)
);
create index product_variants_product_id_idx on public.product_variants(product_id);

create table public.product_images (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 image_key text not null,
 alt_text text,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
create index product_images_product_sort_idx on public.product_images(product_id, sort_order);

create table public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number bigint generated always as identity unique,
 customer_name text not null,
 customer_email text not null,
 customer_phone text,
 shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
 status text not null default 'pending' check (status in ('pending','paid','processing','shipped','completed','cancelled')),
 payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','partially_refunded','refunded','failed')),
 currency text not null default 'SEK' check (currency = 'SEK'),
 subtotal integer not null check (subtotal >= 0),
 shipping_cost integer not null default 0 check (shipping_cost >= 0),
 total integer not null check (total >= 0 and total = subtotal + shipping_cost),
 customer_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index orders_created_at_idx on public.orders(created_at desc);
create index orders_customer_email_idx on public.orders(customer_email);

create table public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 product_id uuid references public.products(id) on delete set null,
 variant_id uuid references public.product_variants(id) on delete set null,
 product_name text not null,
 sku text,
 quantity integer not null check (quantity > 0),
 unit_price integer not null check (unit_price >= 0),
 line_total integer generated always as (quantity * unit_price) stored,
 customization jsonb not null default '{}'::jsonb check (jsonb_typeof(customization) = 'object'),
 created_at timestamptz not null default now()
);
create index order_items_order_id_idx on public.order_items(order_id);

create table public.payments (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 provider text not null,
 provider_payment_id text,
 amount integer not null check (amount >= 0),
 currency text not null default 'SEK' check (currency = 'SEK'),
 status text not null default 'pending' check (status in ('pending','succeeded','failed','cancelled','refunded','partially_refunded')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (provider, provider_payment_id)
);
create index payments_order_id_idx on public.payments(order_id);

create function public.webshop_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger products_updated_at before update on public.products
for each row execute function public.webshop_set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function public.webshop_set_updated_at();
create trigger payments_updated_at before update on public.payments
for each row execute function public.webshop_set_updated_at();

-- No direct client access by default. API will use a trusted server-side role.
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

-- Public read-only catalog access; no direct writes from browser/anon.
create policy products_public_read on public.products for select to anon, authenticated using (active = true);
create policy variants_public_read on public.product_variants for select to anon, authenticated
using (active = true and exists (select 1 from public.products p where p.id = product_id and p.active = true));
create policy images_public_read on public.product_images for select to anon, authenticated
using (exists (select 1 from public.products p where p.id = product_id and p.active = true));

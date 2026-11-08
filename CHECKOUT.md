# Testa köpflödet lokalt

1. Kör databasändringen i `supabase/migrations/20261102120000_stripe_checkout.sql` mot din testdatabas. Den kompletterar den ursprungliga webshop-migrationen och är inte körd automatiskt.
2. API: konfigurera `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (testnyckel), `STRIPE_WEBHOOK_SECRET` och `FRONTEND_URL=http://localhost:3000` i `.env`.
3. Frontend: konfigurera `NEXT_PUBLIC_SERVER_URL=http://localhost:8080` i `.env.local`.
4. Starta API med `npm run devStart` och frontend med `npm run dev`.
5. Kör `stripe listen --forward-to localhost:8080/webhooks/stripe` med Stripe CLI. Lägg dess webhookhemlighet i API:ts `.env` och starta om API:t.
6. Lägg en aktiv produktvariant i varukorgen och välj Till kassan. Använd testkort `4242 4242 4242 4242`, ett framtida utgångsdatum och valfri tresiffrig CVC.
7. Kontrollera att bekräftelsesidan visar ordernummer, att ordern är `paid`, att exakt en lyckad betalning finns i `payments` och att varukorgen töms.
8. Skicka om samma webhook och kontrollera att ingen extra betalning skapas. Avbryt ett nytt köp och kontrollera att varukorgen finns kvar. Testa nekat kort enligt Stripes testdokumentation.

Webhooken hanterar `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` och `checkout.session.expired`. Registrera dessa för den publicerade API-adressen före drift.

Betalstatus och kund-/leveransuppgifter sparas tillsammans med betalningen i en databastransaktion. Fördröjda händelser kan inte skriva över en redan betald order. Bekräftelsesidan kan också synkronisera en betald session om webhooken dröjer. Statussvaret innehåller inga kunduppgifter; session-ID:t fungerar som en hemlig referens för gästens köp.

Frakt är tills vidare 0 kr. Slutliga fraktregler och ordermejl återstår.

Referens: https://docs.stripe.com/checkout/fulfillment

Automatiserade API-tester (med isolerad Stripe- och databasersättning):
`node --require ts-node/register --test tests/checkout.test.ts`
Databastransaktionen och ett verkligt Stripe-testköp behöver verifieras mot testdatabasen enligt stegen ovan.

## Lagerreservation

Kör även `supabase/migrations/20261102150000_inventory_reservations.sql` i Supabase SQL Editor innan den nya API-koden används. Migreringen är inte körd automatiskt. Avsluta gamla öppna Stripe-kassor innan du aktiverar lagerflödet; äldre order ligger kvar som `legacy` och får inga retroaktiva lageravdrag.

- `stock_quantity` är det fysiska lagret. `reserved_quantity` är den del som hålls för pågående kassor. Publika API-svar visar tillgängligt antal i `stock_quantity`, medan admin visar fysiskt, reserverat och tillgängligt antal.
- Stripe-sessionen skapas och kopplas till ordern först. Därefter låser en databastransaktion varianterna i stabil ordning, kontrollerar aktuella priser/aktivitet och reserverar alla rader. Kunden får betalningslänken först efter lyckad reservation. Om en rad saknar lager rullas hela reservationen tillbaka och Stripe-sessionen avslutas.
- Betald order minskar både fysiskt och reserverat lager i samma transaktion som betalningen sparas. Upprepade besked drar inte av igen. Beställningsvaror använder inget fysiskt lager; varje reservation behåller sin ursprungliga mängd även om varianten ändras under köpet.
- Kassan gäller i 30 minuter. Tillbakaknappen från Stripe begär att API:t avslutar sessionen innan reservationen släpps. Om kunden bara stänger fliken släpps lagret efter Stripes `checkout.session.expired`.
- API:t kontrollerar kvarvarande reservationer vid start och varje minut. Det reparerar missade webhookbesked för betalda, utgångna och slutligt misslyckade sessioner. Vid nätfel behålls reservationen tills Stripe kan kontrolleras. Fördröjda betalningar som fortfarande behandlas behåller sin reservation även efter 30 minuter.
- Admin kan inte sänka fysiskt lager under reserverat antal. En gammal adminblankett får inte skriva över ett saldo som ändrats genom ett köp.
- Återbetalningar fyller inte automatiskt på lagret. Fysiska returer behöver kontrolleras och lagret justeras i admin.

Testa med en variant med ett exemplar i två separata webbläsare: öppna första kassan, kontrollera att andra kassan nekas, återvänd från första kassan och kontrollera att exemplaret går att köpa igen. Genomför sedan betalning och kontrollera att fysiskt lager blir noll, reservationen noll och en omsänd webhook inte ändrar saldot.

`npm test` kör API-tester och databastransaktioner i isolerad PostgreSQL via PGlite utan åtkomst till din riktiga databas. PGlite serialiserar anrop; samtidiga servertransaktioner med flera anslutningar behöver också verifieras i testmiljön. Referenser: https://docs.stripe.com/payments/checkout/managing-limited-inventory och https://pglite.dev/docs/.

## Orderhantering i admin

Öppna `/admin/orders` via Beställningar i adminmenyn. Listan har statusfilter och visar 20 order per sida, nyaste först. Orderdetaljerna innehåller beställda produkter, antal, variant, artikelnummer, kunduppgifter, leveransadress, belopp, registrerade betalningar och lagerstatus. Nya köp sparar variantbeskrivningen på orderraden. För äldre order visas nuvarande variantuppgifter om de finns kvar.

Betalda order kan flyttas från Betald till Under behandling eller Skickad, från Under behandling till Skickad och från Skickad till Slutförd. API:t kontrollerar atomärt att ordern fortfarande har den förväntade statusen och är fullt betald. Administratören kan inte ändra betalstatus via denna funktion. Statusändringar skickar ännu inga mejl och skapar inga fraktsedlar.

Alla `/orders`-anrop kräver samma administratör som övriga skyddade API-rutter (`ADMIN_USER_ID`). Svaren får inte cachas. Ingen ytterligare SQL-migration behövs för orderhanteringen.

## Orderbekräftelse via mejl

Kör `supabase/migrations/20261102180000_order_confirmation_emails.sql` i Supabase SQL Editor innan du använder den uppdaterade orderdetaljsidan och starta sedan om API:t. Tidigare betalda order får inga retroaktiva mejl.

API:t använder den befintliga Gmail-konfigurationen: `GMAIL_USER` som avsändare och `GMAIL_PASS` som app-lösenord. `ORDER_EMAIL_REPLY_TO` är valfri och anger adressen kunden ska kontakta; annars används `GMAIL_USER`. Mejlet går till kundens e-postadress från Stripe. Även Stripe-testköp kan skicka riktiga mejl, så ange en egen adress i testkassan. Inga riktiga utskick görs av de automatiserade testerna.

En databas-trigger köar en enda orderbekräftelse när betalstatus blir `paid`, i samma transaktion som orderuppdateringen. API:t behandlar kön var 15:e sekund. Mejlet innehåller ordernummer, datum, produkter/varianter/antal, priser, frakt, totalsumma, leveransadress och kontaktadress i text och HTML. HTML-innehåll från kunden eller produkterna kodas säkert.

Admin visar utskicksstatus på orderdetaljsidan. `Skickad` innebär att Gmail accepterat mejlet, inte en garanti att det nått inkorgen. Kontrollera även skräpposten vid test.

Kända fel före utskick eller tydliga SMTP-avslag får upp till fem försök med ökande väntetid. Vid timeout, avbrott eller om Gmail accepterat mejlet men databasen inte kunde uppdateras, markeras status `uncertain` och automatiska försök stoppas för att undvika dubbelutskick. En övergiven `sending` blir också `uncertain` efter tio minuter. SMTP har inget garanterat stöd för exakt ett utskick över nätavbrott; ett stabilt Message-ID hjälper identifiering men ersätter inte kontroll av ett osäkert utskick.

För `uncertain`: kontrollera Gmail Skickat efter ordernummer och jämför mottagaren innan någon manuell åtgärd. För `failed`: rätta Gmail-konfigurationen eller mottagaruppgifterna. Utskicken kan kontrolleras i tabellen `order_confirmation_emails`; funktion för manuell omsändning ingår inte ännu. Leveransstatusändringar (Skickad/Slutförd) skickar inte ytterligare mejl.

Testa ett nytt köp med din egen mejladress, vänta cirka 15 sekunder och uppdatera ordern i admin. Kontrollera mejlets belopp och leveransadress. Ladda om bekräftelsesidan/skicka om betalningsbeskedet och kontrollera att bara en köpost och ett mejl skapas.

Referenser: https://nodemailer.com/smtp och https://nodemailer.com/message.

Efter ett Stripe-testköp: öppna ordern i admin, kontrollera antal/variant och leveransuppgifter, markera den Under behandling, därefter Skickad och Slutförd. Kontrollera att en obetald order inte har dessa åtgärder. Om en order ändrats i en annan flik, uppdatera sidan innan nästa statusändring.

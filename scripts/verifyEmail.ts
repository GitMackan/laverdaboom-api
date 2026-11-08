import "dotenv/config";
import nodemailer from "nodemailer";
import { mailTlsOptions } from "../lib/mailTls";

async function verifyEmail() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) throw new Error("GMAIL_USER eller GMAIL_PASS saknas.");
  const transport = nodemailer.createTransport({
    service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    tls: mailTlsOptions(),
    dnsTimeout: 5_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
  });
  const deadline = setTimeout(() => {
    console.error("Kontrollen tog för lång tid. Kontrollera anslutningen till smtp.gmail.com:465. Inget mejl har skickats.");
    transport.close(); process.exit(1);
  }, 20_000);
  try {
    await transport.verify();
    console.log("Gmail-anslutning och inloggning fungerar. Inget mejl har skickats.");
  } catch (error) {
    const smtp = error as { code?: string; command?: string; message?: string };
    let details = [smtp.code, smtp.command, smtp.message].filter(Boolean).join(" · ");
    details = details.split(process.env.GMAIL_PASS).join("[redacted]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
    console.error("Gmail-kontroll misslyckades:", details);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); transport.close(); }
}
void verifyEmail().catch(() => { console.error("GMAIL_USER eller GMAIL_PASS saknas."); process.exitCode = 1; });

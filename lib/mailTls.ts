import * as tls from "node:tls";

// Include locally trusted CAs (for example a company's TLS inspection CA)
// alongside Node's normal roots. Never disable certificate verification.
export function mailTlsOptions() {
  if (typeof tls.getCACertificates !== "function") return { rejectUnauthorized: true };
  return {
    rejectUnauthorized: true,
    ca: Array.from(new Set([
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
    ])),
  };
}

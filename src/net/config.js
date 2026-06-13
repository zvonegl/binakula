// Adresa PartyKit servera. U razvoju je lokalni dev server; u objavljenoj
// verziji postavlja se preko VITE_PARTYKIT_HOST (npr. binakula.korisnik.partykit.dev).
export const PARTY_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ||
  (import.meta.env.DEV ? `${location.hostname}:1999` : '');

export const ONLINE_ENABLED = !!PARTY_HOST;

// ───────────────────────────────────────────────────────────────
//  Raumplan – Konfiguration
//
//  Solange SUPABASE_URL leer ist, läuft die App im DEMO-MODUS:
//  Die Daten liegen nur im Browser dieses Geräts (zum Ausprobieren).
//
//  Für den echten Betrieb: Supabase-Projekt anlegen (siehe README.md)
//  und hier die beiden Werte aus  Project Settings → API  eintragen.
//  Der "anon public" Schlüssel darf öffentlich sein – geschützt wird
//  über die Zugriffsregeln in supabase/schema.sql.
// ───────────────────────────────────────────────────────────────

export const SUPABASE_URL = "";      // z.B. "https://abcdefgh.supabase.co"
export const SUPABASE_ANON_KEY = ""; // langer Schlüssel "eyJhbGciOi..."

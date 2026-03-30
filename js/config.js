/**
 * config.js - Supabase 연결 설정
 *
 * Supabase 대시보드 → Settings → API 에서 복사
 *   - Project URL : SupabaseConfig.url
 *   - anon public : SupabaseConfig.anonKey
 *
 * anon key는 RLS(Row Level Security)로 보호되므로 클라이언트에 노출해도 안전합니다.
 */
const SupabaseConfig = {
  url:     'https://yfvskcrvfnusgtznrkhh.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmdnNrY3J2Zm51c2d0em5ya2hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjc3MTksImV4cCI6MjA4ODkwMzcxOX0.32USoe7424PTKL2TrmobKooq_8x-5BGLIUokChy4C24',
};

/** 카드 ID SHA-256 해싱 (솔트 적용) */
const CARD_HASH_SALT = 'rfid-att-2026-salt';
async function hashCardId(rawCardId) {
  const data = new TextEncoder().encode(CARD_HASH_SALT + rawCardId);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

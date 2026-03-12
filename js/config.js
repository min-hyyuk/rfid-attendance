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

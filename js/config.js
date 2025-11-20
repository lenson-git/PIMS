// Supabase 配置
export const SUPABASE_URL = 'https://mgcfsinockiucyvptluv.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY2ZzaW5vY2tpdWN5dnB0bHV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NDk0NDMsImV4cCI6MjA3OTAyNTQ0M30.gWn0UWWmsc2xhK2zo4tx0yK1eATbtP2-dUC8PQZ2Hm4'

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export const CONFIG = {
  STORAGE_BUCKET: 'products',
  ALLOWED_EMAIL: 'lenson.sz@gmail.com'
}

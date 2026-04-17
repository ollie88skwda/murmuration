import { createClient } from '@supabase/supabase-js'

// Fallbacks keep `createClient` from throwing at module load during `next build`
// (page-data collection) when env vars aren't injected — e.g. CI running
// `vercel build` without `vercel pull`. At runtime the real NEXT_PUBLIC_*
// values are inlined by the Next.js build.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Tenta pegar como VITE_SUPABASE_ANON_KEY, se não tiver pega PUBLISHABLE_KEY
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('As variáveis de ambiente do Supabase não estão definidas.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

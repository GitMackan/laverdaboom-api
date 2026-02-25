// supabase.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL; // t.ex. https://xxxx.supabase.co
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Anon key eller service key

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
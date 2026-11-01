import { createClient, User } from '@supabase/supabase-js';
import { Request, Response, NextFunction } from 'express';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user ? : User;
        }
    }
}

const requireAuth = async(req: Request, res: Response, next: NextFunction): Promise < void > => {
    if (!req.headers.authorization) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = req.headers.authorization.replace('Bearer ', '');

    if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

   const { data: { user }, error } = await supabase.auth.getUser(token);

if (
    error ||
    !user ||
    user.id !== process.env.ADMIN_USER_ID
) {
    res.status(401).json({ error: "Unauthorized" });
    return;
}

req.user = user;
next();
};

export default requireAuth;
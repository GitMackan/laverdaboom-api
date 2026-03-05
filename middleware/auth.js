const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const requireAuth = async(req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = req.headers.authorization.replace('Bearer ', '')

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    req.user = user
    next()
}

module.exports = requireAuth
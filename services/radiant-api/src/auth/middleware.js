const { verify } = require('./jwt');

async function authMiddleware(req, pool) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'No token provided' };
  }

  const token = authHeader.slice(7);
  
  // Verify JWT
  const verification = verify(token);
  if (!verification.valid) {
    return { authenticated: false, error: verification.error };
  }

  const payload = verification.payload;

  // Check if session exists and is not expired
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id FROM admin_sessions WHERE token = $1 AND expires_at > NOW()',
        [token]
      );

      if (result.rows.length === 0) {
        return { authenticated: false, error: 'Session expired or invalid' };
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Session validation error:', error);
    return { authenticated: false, error: 'Session validation failed' };
  }

  // Check if user is still active
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT status FROM admin_users WHERE id = $1',
        [payload.userId]
      );

      if (result.rows.length === 0) {
        return { authenticated: false, error: 'User not found' };
      }

      if (result.rows[0].status !== 'active') {
        return { authenticated: false, error: 'Account is not active' };
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User validation error:', error);
    return { authenticated: false, error: 'User validation failed' };
  }

  return {
    authenticated: true,
    user: {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      djId: payload.djId
    }
  };
}

function requireAuth(handler) {
  return async (req, res, corsHeaders, pool) => {
    const auth = await authMiddleware(req, pool);
    
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: 'Unauthorized', message: auth.error }));
      return;
    }

    return handler(req, res, corsHeaders, auth.user);
  };
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (handler) => {
    return async (req, res, corsHeaders, pool) => {
      const auth = await authMiddleware(req, pool);
      
      if (!auth.authenticated) {
        res.writeHead(401, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Unauthorized', message: auth.error }));
        return;
      }

      if (!allowedRoles.includes(auth.user.role)) {
        res.writeHead(403, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Forbidden', message: 'Insufficient permissions' }));
        return;
      }

      return handler(req, res, corsHeaders, auth.user);
    };
  };
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireRole
};

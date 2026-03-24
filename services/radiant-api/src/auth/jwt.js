const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required');
  process.exit(1);
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str) {
  str += new Array(5 - str.length % 4).join('=');
  return Buffer.from(str.replace(/\-/g, '+').replace(/\_/g, '/'), 'base64');
}

function sign(payload, expiresIn = '7d') {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const now = Math.floor(Date.now() / 1000);
  let exp;
  if (typeof expiresIn === 'string') {
    const match = expiresIn.match(/^(\d+)([dhms])$/);
    if (match) {
      const [, num, unit] = match;
      const multipliers = { d: 86400, h: 3600, m: 60, s: 1 };
      exp = now + parseInt(num) * multipliers[unit];
    } else {
      exp = now + 604800; // Default 7 days
    }
  } else {
    exp = now + expiresIn;
  }
  
  const claims = {
    ...payload,
    iat: now,
    exp: exp
  };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedClaims}`)
    .digest();
  
  return `${encodedHeader}.${encodedClaims}.${base64UrlEncode(signature)}`;
}

function verify(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${encodedHeader}.${encodedClaims}`)
      .digest();
    
    const actualSignature = base64UrlDecode(encodedSignature);
    if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    // Parse and verify claims
    const claims = JSON.parse(base64UrlDecode(encodedClaims).toString());
    
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token expired' };
    }
    
    return { valid: true, payload: claims };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  sign,
  verify,
  generateRefreshToken
};

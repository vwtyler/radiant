const https = require('https');
const querystring = require('querystring');

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.kaad-lp.org';
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || process.env.SMTP_PASSWORD;
const MAILGUN_FROM = process.env.MAILGUN_FROM || process.env.SMTP_FROM || 'noreply@kaad-lp.org';

function sendMailgunEmail({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    if (!MAILGUN_API_KEY) {
      console.warn('MAILGUN_API_KEY not configured, email will be logged but not sent');
      console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
      resolve({ success: true, mock: true });
      return;
    }

    const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
    const data = querystring.stringify({
      from: MAILGUN_FROM,
      to: to,
      subject: subject,
      text: text,
      html: html
    });

    const options = {
      hostname: 'api.mailgun.net',
      port: 443,
      path: `/v3/${MAILGUN_DOMAIN}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Basic ${auth}`
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else {
          console.error('Mailgun API error:', res.statusCode, responseData);
          reject(new Error(`Mailgun API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Mailgun request error:', error);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function sendInvitationEmail({ to, token, role, invitedBy }) {
  const roleDisplay = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  const acceptUrl = `https://admin.kaad-lp.org/accept-invite?token=${token}`;

  const text = `Hello,

You've been invited to join the KAAD-LP admin panel as a ${roleDisplay}.

Click here to accept your invitation and set up your account:
${acceptUrl}

This link expires in 7 days.

If you didn't expect this invitation, you can ignore this email.

Best regards,
KAAD-LP Team`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c4f73;">Welcome to KAAD-LP Admin</h2>
    
    <p>Hello,</p>
    
    <p>You've been invited to join the KAAD-LP admin panel as a <strong>${roleDisplay}</strong>.</p>
    
    <div style="margin: 30px 0;">
      <a href="${acceptUrl}" 
         style="background-color: #2c4f73; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Accept Invitation
      </a>
    </div>
    
    <p style="font-size: 14px; color: #666;">
      Or copy and paste this link:<br>
      <code style="background: #f5f5f5; padding: 5px; word-break: break-all;">${acceptUrl}</code>
    </p>
    
    <p style="color: #999; font-size: 13px;">This link expires in 7 days.</p>
    
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    
    <p style="color: #666; font-size: 12px;">
      If you didn't expect this invitation, you can ignore this email.<br>
      Best regards,<br>
      KAAD-LP Team
    </p>
  </div>
</body>
</html>`;

  try {
    return await sendMailgunEmail({ to, subject: `You've been invited to manage KAAD-LP as ${roleDisplay}`, text, html });
  } catch (error) {
    console.error('Failed to send invitation email:', error);
    return { success: false, error: error.message };
  }
}

async function sendPasswordResetEmail({ to, token }) {
  const resetUrl = `https://admin.kaad-lp.org/reset-password?token=${token}`;

  const text = `Hello,

We received a request to reset your KAAD-LP admin password.

Click here to reset your password:
${resetUrl}

This link expires in 1 hour.

If you didn't request this reset, you can ignore this email.

Best regards,
KAAD-LP Team`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c4f73;">Password Reset Request</h2>
    
    <p>Hello,</p>
    
    <p>We received a request to reset your KAAD-LP admin password.</p>
    
    <div style="margin: 30px 0;">
      <a href="${resetUrl}" 
         style="background-color: #2c4f73; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Reset Password
      </a>
    </div>
    
    <p style="font-size: 14px; color: #666;">
      Or copy and paste this link:<br>
      <code style="background: #f5f5f5; padding: 5px; word-break: break-all;">${resetUrl}</code>
    </p>
    
    <p style="color: #d9534f; font-size: 13px;">This link expires in 1 hour.</p>
    
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    
    <p style="color: #666; font-size: 12px;">
      If you didn't request this reset, you can ignore this email.<br>
      Best regards,<br>
      KAAD-LP Team
    </p>
  </div>
</body>
</html>`;

  try {
    return await sendMailgunEmail({ to, subject: 'Reset your KAAD-LP admin password', text, html });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return { success: false, error: error.message };
  }
}

async function sendWelcomeEmail({ to, role }) {
  const roleDisplay = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const text = `Hello,

Your KAAD-LP admin account has been successfully set up as a ${roleDisplay}.

You can now log in at:
https://admin.kaad-lp.org

Best regards,
KAAD-LP Team`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c4f73;">Welcome to KAAD-LP Admin!</h2>
    
    <p>Hello,</p>
    
    <p>Your KAAD-LP admin account has been successfully set up as a <strong>${roleDisplay}</strong>.</p>
    
    <div style="margin: 30px 0;">
      <a href="https://admin.kaad-lp.org" 
         style="background-color: #2c4f73; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Log In Now
      </a>
    </div>
    
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    
    <p style="color: #666; font-size: 12px;">
      Best regards,<br>
      KAAD-LP Team
    </p>
  </div>
</body>
</html>`;

  try {
    return await sendMailgunEmail({ to, subject: 'Welcome to KAAD-LP Admin', text, html });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail
};

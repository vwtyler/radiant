const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.mailgun.org';
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@kaad-lp.org';

let transporter = null;

function getTransporter() {
  if (!transporter) {
    if (!SMTP_USER || !SMTP_PASSWORD) {
      console.warn('SMTP credentials not configured, emails will not be sent');
      return null;
    }
    
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD
      }
    });
  }
  return transporter;
}

async function sendInvitationEmail({ to, token, role, invitedBy }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[EMAIL MOCK] Invitation to ${to} with token ${token}`);
    return { success: true, mock: true };
  }
  
  const roleDisplay = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  const acceptUrl = `https://admin.kaad-lp.org/accept-invitation/${token}`;
  
  try {
    await transporter.sendMail({
      from: `"KAAD-LP Admin" <${SMTP_FROM}>`,
      to,
      subject: `You've been invited to manage KAAD-LP as ${roleDisplay}`,
      text: `Hello,

You've been invited to join the KAAD-LP admin panel as a ${roleDisplay}.

Click here to accept your invitation and set up your account:
${acceptUrl}

This link expires in 7 days.

If you didn't expect this invitation, you can ignore this email.

Best regards,
KAAD-LP Team`,
      html: `<!DOCTYPE html>
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
</html>`
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to send invitation email:', error);
    return { success: false, error: error.message };
  }
}

async function sendPasswordResetEmail({ to, token }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[EMAIL MOCK] Password reset to ${to} with token ${token}`);
    return { success: true, mock: true };
  }
  
  const resetUrl = `https://admin.kaad-lp.org/reset-password/${token}`;
  
  try {
    await transporter.sendMail({
      from: `"KAAD-LP Admin" <${SMTP_FROM}>`,
      to,
      subject: 'Reset your KAAD-LP admin password',
      text: `Hello,

We received a request to reset your KAAD-LP admin password.

Click here to reset your password:
${resetUrl}

This link expires in 1 hour.

If you didn't request this reset, you can ignore this email.

Best regards,
KAAD-LP Team`,
      html: `<!DOCTYPE html>
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
</html>`
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return { success: false, error: error.message };
  }
}

async function sendWelcomeEmail({ to, role }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[EMAIL MOCK] Welcome to ${to}`);
    return { success: true, mock: true };
  }
  
  const roleDisplay = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  try {
    await transporter.sendMail({
      from: `"KAAD-LP Admin" <${SMTP_FROM}>`,
      to,
      subject: 'Welcome to KAAD-LP Admin',
      text: `Hello,

Your KAAD-LP admin account has been successfully set up as a ${roleDisplay}.

You can now log in at:
https://admin.kaad-lp.org

Best regards,
KAAD-LP Team`,
      html: `<!DOCTYPE html>
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
</html>`
    });
    
    return { success: true };
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

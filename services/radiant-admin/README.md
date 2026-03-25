# Radiant Admin App

React-based web application for radio station operations with full authentication and user management.

## Features

### Authentication & Security

- **Secure Login**: Email/password with "remember me" option
- **Automatic Token Refresh**: Seamless session management
- **Role-Based UI**: Interface adapts to user permissions
- **Protected Routes**: Automatic redirect to login when unauthenticated
- **Password Management**: Self-service password change with validation

### Schedule Management

- **Visual Calendar**: Week and day views with drag-and-drop
- **Slot Management**: Create, edit, move, resize, and delete slots
- **Staged Editing**: Preview changes before committing
- **Mobile Support**: Touch-friendly day-by-day navigation
- **Show Integration**: Link slots to shows and DJs

### User Management (Admin Only)

- **Invite Users**: Send email invitations with role assignment
- **Manage Users**: Edit roles, deactivate accounts, delete users
- **Password Resets**: Admin-initiated password resets
- **Role Assignment**: Super Admin, Admin, or DJ roles
- **Audit View**: See user login history and status

### User Profile

Access via clicking your email in the hamburger menu:

- **Account Information**: Email, role, status, member since, last login
- **DJ Association**: Link your account to a DJ profile (DJ role)
- **Password Change**: Update your password securely
- **Security**: View account status and activity

### Reporting

Generate standardized reports for:
- SoundExchange (pipe-delimited)
- BMI Music Plays (CSV)

### Settings

- **Icecast Integration**: Configure metadata push settings
- **Site Branding**: Customize admin panel titles
- **Stream Testing**: Test Icecast connectivity

## User Interface

### Navigation

The app uses a tab-based navigation system:

1. **Schedule** - Visual weekly/day schedule editor
2. **Shows** - Show management and DJ assignments
3. **Reports** - Generate and download reports
4. **Stats** - Live listener counts and geographic data
5. **Users** - User management (admin only)
6. **Settings** - Icecast configuration and branding
7. **Profile** - Account settings and DJ linking

### Role-Based Access

| Feature | Super Admin | Admin | DJ |
|---------|-------------|-------|-----|
| Schedule Edit | ✅ | ✅ | ✅ |
| Show Management | ✅ | ✅ | ✅ |
| User Management | ✅ | ✅ | ❌ |
| Invite Users | ✅ | ✅ | ❌ |
| Delete Users | ✅ | ✅ | ❌ |
| Reset Passwords | ✅ | ✅ | ❌ |
| Edit Own Shows | ✅ | ✅ | ✅ |
| Link DJ Profile | ✅ | ✅ | ✅ |
| Icecast Settings | ✅ | ✅ | ❌ |
| Reports | ✅ | ✅ | ✅ |

### Hamburger Menu

Click ☰ to access:
- User info card (click to go to Profile)
- Navigation tabs
- Logout button

## Authentication Flow

1. **Login**: User enters email/password
2. **Token Storage**: JWT access token stored in localStorage
3. **Auto-Refresh**: Silent token refresh before expiration
4. **API Requests**: Bearer token automatically included
5. **Session Expiry**: Redirect to login on auth failure
6. **Logout**: Clear tokens and return to login

## Getting Started

### Prerequisites

- Node.js 18+
- Running `radiant-api` service
- Valid user account (or use invitation flow)

### Development

```bash
# From repository root
docker compose up radiant-api -d

cd services/radiant-admin
npm install
npm run dev
```

Open http://localhost:5173

### Production Build

```bash
cd services/radiant-admin
npm install
npm run build
```

## Environment Variables

Create `.env` file in `services/radiant-admin/`:

```bash
# API Configuration
VITE_API_BASE_URL=http://localhost:3000

# Admin Token (legacy support)
VITE_ADMIN_TOKEN=your-legacy-token
```

For production, point `VITE_API_BASE_URL` to your API server.

## Project Structure

```
services/radiant-admin/
├── src/
│   ├── auth/
│   │   ├── AuthContext.jsx      # Authentication state & API
│   │   ├── LoginPage.jsx        # Login form
│   │   ├── UserMenu.jsx         # User dropdown menu
│   │   ├── InviteModal.jsx      # User invitation modal
│   │   ├── ChangePasswordDialog.jsx  # Password change form
│   │   ├── AcceptInvitePage.jsx # Invitation acceptance
│   │   ├── ForgotPasswordPage.jsx    # Password reset request
│   │   ├── ResetPasswordPage.jsx     # Password reset form
│   │   └── auth.css             # Authentication styles
│   ├── pages/
│   │   ├── UsersTab.jsx         # User management interface
│   │   └── UserProfileTab.jsx   # User profile page
│   ├── lib/
│   │   └── apiAdapter.js        # API client with auth headers
│   ├── App.jsx                  # Main application with routing
│   └── styles.css               # Global styles
├── index.html
├── package.json
└── Dockerfile
```

## Key Components

### AuthContext

Provides authentication state and methods:

```javascript
const { 
  user,              // Current user object
  login,             // Login function
  logout,            // Logout function
  hasRole,           // Check user role
  isAuthenticated,   // Boolean auth state
  loading            // Auth loading state
} = useAuth();
```

### useApi Hook

Automatic token refresh on 401 responses:

```javascript
const { apiFetch } = useApi();

const response = await apiFetch('/v1/admin/users');
```

### ProtectedRoute

Routes that require authentication automatically redirect to login.

## Password Requirements

When setting or changing passwords, the following are enforced:

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)

## User Invitation Flow

1. Admin clicks "Invite User" in Users tab
2. Enters email and selects role
3. System sends invitation email via Mailgun
4. User clicks link in email (`/accept-invite?token=...`)
5. User sets password and account is created
6. User can now log in with email/password

## DJ Profile Linking

For DJ users:

1. Go to Profile tab (click email in menu)
2. Select DJ from dropdown
3. Click "Link DJ"
4. Account is now associated with DJ profile
5. Can edit own shows and see DJ-specific data

## Troubleshooting

### "No token provided" Error

- Clear localStorage and log in again
- Check that API is running
- Verify JWT_SECRET is set correctly

### Email Not Sending

- Check Mailgun API key in `.env`
- Verify domain is verified in Mailgun
- Check API logs for email errors

### Cannot Access Users Tab

- Only admins and super_admins can see Users tab
- Check your role in Profile page

### Password Change Fails

- Ensure current password is correct
- New password must meet requirements (8+ chars, uppercase, lowercase, number)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Development Tips

### Hot Reload

Vite provides hot module replacement. Changes to React components reload instantly.

### API Proxy

During development, API calls are proxied to avoid CORS issues.

### Debugging Auth

Check browser DevTools:
- Application → Local Storage → accessToken
- Network tab for API requests
- Console for auth errors

## Building for Production

```bash
npm run build
```

Output goes to `dist/` directory. Serve with any static file server.

## See Also

- [Root README](../../README.md) - Project overview
- [API README](../radiant-api/README.md) - Backend documentation
- [DEVELOPMENT.md](../../DEVELOPMENT.md) - Development guide
- [WordPress Plugin](../wordpress-plugins/radiant-wp-shortcodes/) - Public display components

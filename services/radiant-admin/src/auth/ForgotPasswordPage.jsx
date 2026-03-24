import React, { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function getApiBase() {
  if (API_BASE_URL && !API_BASE_URL.includes("localhost")) {
    return API_BASE_URL;
  }
  const { protocol, hostname } = window.location;
  const inferredHost = hostname.includes("admin")
    ? hostname.replace("admin.", "api.").replace("-admin.", "-api.").replace("admin-", "api-")
    : hostname;
  return `${protocol}//${inferredHost}`;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`${getApiBase()}/v1/admin/auth/forgot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      // Always show success to prevent email enumeration
      setSubmitted(true);
    } catch (err) {
      // Still show success even on error
      setSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>KAAD-LP Admin</h1>
          <h2>Check Your Email</h2>
          <p>
            If an account exists for {email}, you will receive a password reset link.
          </p>
          <button 
            className="primary"
            onClick={() => window.location.href = "/"}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>KAAD-LP Admin</h1>
        <h2>Reset Password</h2>
        <p>Enter your email and we'll send you a link to reset your password.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="primary"
            disabled={isLoading}
          >
            {isLoading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <div className="auth-links">
          <a href="/">Back to login</a>
        </div>
      </div>
    </div>
  );
}

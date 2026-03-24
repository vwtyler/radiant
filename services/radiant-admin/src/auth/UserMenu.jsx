import React, { useState } from "react";
import { useAuth } from "./AuthContext";

export function UserMenu() {
  const { user, logout, hasRole } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  function getRoleLabel(role) {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "admin":
        return "Admin";
      case "dj":
        return "DJ";
      default:
        return role;
    }
  }

  return (
    <div className="user-menu">
      <button 
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="user-email">{user.email}</span>
        <span className="user-role">{getRoleLabel(user.role)}</span>
        <span className="dropdown-arrow">▼</span>
      </button>

      {isOpen && (
        <>
          <div 
            className="user-menu-overlay"
            onClick={() => setIsOpen(false)}
          />
          <div className="user-menu-dropdown">
            <div className="user-menu-header">
              <strong>{user.email}</strong>
              <span className="role-badge">{getRoleLabel(user.role)}</span>
            </div>
            
            <div className="user-menu-actions">
              <button 
                className="menu-item"
                onClick={() => {
                  logout();
                  setIsOpen(false);
                }}
                type="button"
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

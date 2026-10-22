export function getAuthErrorMessage(error: unknown): string {
    const code =
      error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
  
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "The email or password is incorrect.";
      case "auth/invalid-email":
        return "Please enter a valid email address.";
      case "auth/user-disabled":
        return "This account has been disabled. Contact support if this is unexpected.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a while and try again.";
      case "auth/network-request-failed":
        return "A network error occurred. Please check your connection and try again.";
      case "auth/account-exists-with-different-credential":
        return "An account already exists with a different sign-in method.";
      case "auth/email-already-in-use":
        return "An account already exists with this email. Please log in instead.";
      case "auth/weak-password":
        return "Your password is too weak. Please choose a stronger password.";
      case "auth/operation-not-allowed":
        return "This sign-in method is currently unavailable. Please try again later.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  
  // Popup-closed-by-user and popup-blocked are handled separately by callers —
  // the former is a deliberate user action (not an error to alarm them with),
  // the latter needs actionable browser-setting guidance, not a generic message.
  export function isUserCancelledPopup(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "auth/popup-closed-by-user");
  }
  
  export function isPopupBlocked(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "auth/popup-blocked");
  }
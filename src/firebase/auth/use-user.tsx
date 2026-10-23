'use client';

import { useState, useEffect } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { useAuth } from '../provider';

export function useUser() {
  const auth = useAuth();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(!auth.currentUser);

  useEffect(() => {
    // onIdTokenChanged fires on sign-in, sign-out, AND silent token refresh
    // (every ~1hr, or on forced getIdToken(true)). onAuthStateChanged only
    // fires on sign-in/sign-out, so a refreshed token never reached Firestore
    // listeners built from this hook's `user` reference — they kept using
    // whatever token existed when the component first mounted.
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [auth]);

  return { user, loading };
}
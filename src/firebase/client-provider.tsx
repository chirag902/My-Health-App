
'use client';

import React, { useMemo } from 'react';
import { initializeFirebase } from './config';
import { FirebaseProvider } from './provider';

export function FirebaseClientProvider({ children }: { children: React.ReactNode }) {
  const { app, firestore, auth } = useMemo(() => initializeFirebase(), []);

  return (
    <FirebaseProvider app={app} firestore={firestore} auth={auth}>
      {children}
    </FirebaseProvider>
  );
}

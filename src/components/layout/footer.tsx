
"use client";

import { useState, useEffect } from 'react';

export default function Footer() {
  const [currentYear, setCurrentYear] = useState<number | null>(null);

  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="bg-background border-t">
      <div className="container mx-auto px-4 py-6 text-center text-muted-foreground">
        <div className="space-y-2">
            {currentYear ? (
            <p>&copy; {currentYear} My HealthApp. All rights reserved.</p>
            ) : (
            <p>&nbsp;</p> 
            )}
            <p className="text-xs max-w-2xl mx-auto">
                This application provides informational insights only and does not replace
                professional medical advice, diagnosis, or treatment.
            </p>
        </div>
      </div>
    </footer>
  );
}

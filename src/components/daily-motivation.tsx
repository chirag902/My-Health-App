"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { getMotivationAction } from '@/app/actions';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { Skeleton } from './ui/skeleton';

export default function DailyMotivation() {
  const [motivation, setMotivation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMotivation() {
      try {
        const result = await getMotivationAction();

        if (result.success === true && result.data) {
          setMotivation(result.data.message);
        } else if (result.success === false) {
          setError(result.error || "Could not fetch motivation.");
        }
      } catch (e) {
        console.error(e);
        setError("An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    }

    fetchMotivation();
  }, []);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-2 w-full">
          <Skeleton className="h-4 w-3/4 bg-primary-foreground/20" />
          <Skeleton className="h-4 w-1/2 bg-primary-foreground/20" />
        </div>
      );
    }

    if (error) {
      return (
        <div className='text-sm flex items-center gap-2'>
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      );
    }

    return (
      <p className="text-lg font-medium">
        {motivation || "Embrace today with a positive mindset. You've got this!"}
      </p>
    );
  };

  return (
    <Card className="bg-primary/80 border-primary text-primary-foreground shadow-lg transition-transform duration-300 hover:scale-105">
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <Sparkles className="w-8 h-8 flex-shrink-0" />
          {renderContent()}
        </div>
      </CardContent>
    </Card>
  );
}

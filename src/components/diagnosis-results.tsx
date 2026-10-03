import type { AiDiagnosisOutput } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { BrainCircuit, Heart, Dumbbell, Utensils, Bed } from 'lucide-react';

interface DiagnosisResultsProps {
  diagnosis: AiDiagnosisOutput['diagnosis'];
}

export default function DiagnosisResults({ diagnosis }: DiagnosisResultsProps) {
  if (!diagnosis) {
    return (
      <p className="text-sm text-muted-foreground">
        No diagnosis available yet. Awaiting more information.
      </p>
    );
  }

  const mentalHealthConditions = diagnosis.mentalHealthConditions ?? ["No specific conditions identified. Please consult a professional."];
  const relatedPhysicalIllnesses = diagnosis.relatedPhysicalIllnesses ?? ["No specific illnesses identified. Please consult a professional."];
  const wellnessAdvice = diagnosis.wellnessAdvice ?? {
      lifestyle: ["Maintain a regular sleep schedule and stay hydrated."],
      mindfulness: ["Practice deep breathing for a few minutes each day."],
      diet: ["Eat a balanced diet with plenty of fruits and vegetables."]
  };
  const confidencePercent = Math.round((diagnosis.confidenceLevel ?? 0) * 100);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-sm text-muted-foreground mb-4">
        Based on our conversation, here is a preliminary analysis.  
        Please consult a healthcare professional for a formal diagnosis.
      </p>

      {/* Mental Health */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Potential Mental Health Conditions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {mentalHealthConditions.length > 0 ? (
              mentalHealthConditions.map((condition, index) => (
                <Badge key={`mh-${index}`} variant="secondary">
                  {condition}
                </Badge>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No mental health indicators found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Physical Illnesses */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Heart className="h-5 w-5 text-destructive" />
            Related Physical Illnesses
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {relatedPhysicalIllnesses.length > 0 ? (
              relatedPhysicalIllnesses.map((illness, index) => (
                <Badge key={`pi-${index}`} variant="outline">
                  {illness}
                </Badge>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No related physical illnesses found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confidence */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="font-medium text-muted-foreground">Confidence Level</span>
          <span className="font-semibold text-primary">{confidencePercent}%</span>
        </div>
        <Progress value={confidencePercent} className="h-2" />
      </div>

      {/* Wellness Advice */}
      <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger className="font-semibold">
            Personalized Wellness Advice
          </AccordionTrigger>

          <AccordionContent className="space-y-3">

            <p className="text-muted-foreground text-xs">
              These are general suggestions and not a prescription.  
              Consult a doctor for personalized medical advice.
            </p>

            {/* Lifestyle */}
            {(wellnessAdvice.lifestyle ?? []).length > 0 && (
              <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-background/50">
                <Dumbbell className="h-5 w-5 mt-1 text-accent flex-shrink-0" />
                <div>
                  <h4 className="font-medium">Lifestyle</h4>
                  <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-1">
                    {wellnessAdvice.lifestyle.map((item, index) => (
                      <li key={`lifestyle-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Mindfulness */}
            {(wellnessAdvice.mindfulness ?? []).length > 0 && (
              <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-background/50">
                <Bed className="h-5 w-5 mt-1 text-accent flex-shrink-0" />
                <div>
                  <h4 className="font-medium">Mindfulness</h4>
                  <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-1">
                    {wellnessAdvice.mindfulness.map((item, index) => (
                      <li key={`mindfulness-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Diet */}
            {(wellnessAdvice.diet ?? []).length > 0 && (
              <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-background/50">
                <Utensils className="h-5 w-5 mt-1 text-accent flex-shrink-0" />
                <div>
                  <h4 className="font-medium">Diet</h4>
                  <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-1">
                    {wellnessAdvice.diet.map((item, index) => (
                      <li key={`diet-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

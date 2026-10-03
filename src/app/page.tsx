
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Stethoscope,
  Users,
  BookText,
  Flame,
  ShieldCheck,
  Sparkles,
  HeartPulse,
} from "lucide-react";
import Footer from "@/components/layout/footer";

export default function Home() {

  return (
    <div className="flex flex-col min-h-screen">
      {/* HEADER */}
      <header className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <HeartPulse className="h-7 w-7 text-primary" />
          <span className="text-xl font-bold text-foreground">My Health App</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/login">Login</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get Started</Link>
          </Button>
        </div>
      </header>

      {/* LANDING */}
      <main className="flex-grow">
        <section className="container mx-auto px-4 py-16 md:py-24 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-primary to-accent text-transparent bg-clip-text">
            Your Journey to Mental Wellness Starts Here
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            Your friendly AI companion for mental and physical well-being. Get
            insights, find support, and take steps toward a healthier you.
          </p>
          <Button asChild size="lg">
            <Link href="/signup">
              Start Your Journey <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </section>

        {/* TOOLKIT CARDS */}
        <section className="bg-muted/50 py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                A Complete Toolkit for Your Well-being
              </h2>
              <p className="text-lg text-muted-foreground mt-2 max-w-2xl mx-auto">
                From AI-powered insights to professional support, we've got you covered.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* AI Companion */}
              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Stethoscope className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>AI Companion</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-left">
                  <CardDescription>
                    Chat with our AI to understand your symptoms and get personalized advice.
                  </CardDescription>
                </CardContent>
              </Card>

              {/* Other Toolkit Cards */}
              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Users className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>Find a Doctor</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Browse a directory of verified specialists and book appointments seamlessly.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <BookText className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>Daily Journaling</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Reflect on your thoughts and feelings in a private, secure space.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Flame className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>Habit Tracker</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Build healthy habits with reminders, streaks, and goal tracking.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <ShieldCheck className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>Secure Records</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Your data is encrypted and fully in your control.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>
                  <CardTitle>Daily Motivation</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    Kickstart every day with an uplifting quote powered by Gemini AI.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

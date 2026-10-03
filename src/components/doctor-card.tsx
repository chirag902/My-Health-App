import Image from "next/image";
import {
  CalendarCheck2,
  MapPin,
  Star,
  Video,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { Doctor } from "@/lib/types";

interface DoctorCardProps {
  doctor: Doctor;
}

function getDoctorInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getRatingLabel(rating: number): string {
  if (rating >= 4.5) return "Excellent";
  if (rating >= 4) return "Very good";
  if (rating >= 3) return "Good";
  return "Rated";
}

export default function DoctorCard({
  doctor,
}: DoctorCardProps) {
  const safeRating = Number.isFinite(doctor.rating)
    ? Math.max(0, Math.min(5, doctor.rating))
    : 0;

  const safeReviews = Number.isFinite(doctor.reviews)
    ? Math.max(0, doctor.reviews)
    : 0;

  const ratingLabel = getRatingLabel(safeRating);
  const initials = getDoctorInitials(doctor.name);

  const dataAiHint = doctor.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();

  return (
    <Card
      className="
        group flex h-full flex-col overflow-hidden
        transition-all duration-200
        hover:-translate-y-0.5 hover:shadow-lg
        focus-within:ring-2 focus-within:ring-primary/30
      "
    >
      {/* ======================================================
          HEADER
          ====================================================== */}

      <CardHeader className="flex-row items-start gap-4 pb-4">
        {/* Doctor avatar */}
        <div className="relative shrink-0">
          {doctor.avatar ? (
            <Image
              src={doctor.avatar}
              alt={`Dr. ${doctor.name}`}
              width={80}
              height={80}
              sizes="80px"
              className="
                h-20 w-20 rounded-full
                border-2 border-primary/20
                object-cover
                transition-transform duration-200
                group-hover:scale-[1.03]
              "
              data-ai-hint={`professional portrait ${dataAiHint}`}
            />
          ) : (
            <div
              className="
                flex h-20 w-20 items-center justify-center
                rounded-full
                border-2 border-primary/20
                bg-primary/10
                text-lg font-semibold text-primary
              "
              aria-label={`Profile placeholder for Dr. ${doctor.name}`}
            >
              {initials}
            </div>
          )}

          {/* Online indicator */}
          <span
            className="
              absolute bottom-0 right-0
              h-4 w-4 rounded-full
              border-2 border-background
              bg-emerald-500
            "
            title="Available online"
            aria-label="Available online"
          />
        </div>

        {/* Doctor information */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold tracking-tight">
            Dr. {doctor.name}
          </h3>

          <p className="mt-0.5 text-sm font-medium text-primary">
            {doctor.specialty}
          </p>

          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />

            <span className="truncate">
              {doctor.location}
            </span>
          </div>
        </div>
      </CardHeader>

      {/* ======================================================
          CONTENT
          ====================================================== */}

      <CardContent className="flex flex-1 flex-col">
        {/* Rating */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="gap-1.5 px-2.5 py-1"
            aria-label={`${safeRating.toFixed(
              1
            )} out of 5 rating from ${safeReviews} reviews`}
          >
            <Star
              className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500"
              aria-hidden="true"
            />

            <span className="font-semibold">
              {safeRating.toFixed(1)}
            </span>

            <span className="text-muted-foreground">
              ({safeReviews})
            </span>
          </Badge>

          <span className="text-xs text-muted-foreground">
            {ratingLabel}
          </span>

          {/* Online consultation */}
          <Badge
            variant="outline"
            className="ml-auto gap-1 text-xs"
          >
            <Video
              className="h-3 w-3"
              aria-hidden="true"
            />
            Online
          </Badge>
        </div>

        {/* Bio */}
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
          {doctor.bio}
        </p>

        {/* Spacer keeps cards equal height */}
        <div className="flex-1" />
      </CardContent>

      {/* ======================================================
          FOOTER
          ====================================================== */}

      <CardFooter className="flex-col gap-2 border-t bg-muted/20 pt-4">
        <Button
          type="button"
          className="w-full"
          aria-label={`Book an appointment with Dr. ${doctor.name}`}
        >
          <CalendarCheck2
            className="mr-2 h-4 w-4"
            aria-hidden="true"
          />
          Book Appointment
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          Appointment availability may vary
        </p>
      </CardFooter>
    </Card>
  );
}
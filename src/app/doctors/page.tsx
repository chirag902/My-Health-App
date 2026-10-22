import { Suspense } from "react";
import type { Metadata } from "next";

import AppShell from "@/components/layout/app-shell";
import DoctorCard from "@/components/doctor-card";
import DoctorFilters from "@/components/doctor-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { getDoctorsAction } from "@/app/actions";
import type { Doctor } from "@/lib/types";

export const metadata: Metadata = {
  title: "Find a Doctor | MyHealthApp",
  description: "Browse our curated list of top-rated, verified health professionals.",
};

interface DoctorsPageProps {
  searchParams: Promise<{
    specialty?: string | string[];
    location?: string | string[];
    availability?: string | string[];
  }>;
}

const normalizeParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

// Collapses hyphens/spaces so slug filter values ("general-practitioner")
// match space-separated data values ("General Practitioner"). Without this,
// every multi-word specialty silently returns zero results.
const normalizeForMatch = (value: string): string =>
  value.toLowerCase().replace(/[-\s]+/g, " ").trim();

export default async function DoctorsPage({ searchParams }: DoctorsPageProps) {
  const [params, doctorsResponse] = await Promise.all([searchParams, getDoctorsAction()]);

  const doctors: Doctor[] =
    doctorsResponse.success && Array.isArray(doctorsResponse.data) ? doctorsResponse.data : [];

  const specialty = normalizeParam(params.specialty) || "all";
  const location = normalizeParam(params.location);
  const availability = normalizeParam(params.availability) || "any";

  const normalizedSpecialty = normalizeForMatch(specialty);
  const normalizedLocation = location.toLowerCase();

  const filteredDoctors = doctors.filter((doctor: Doctor): boolean => {
    const doctorSpecialty = normalizeForMatch(doctor.specialty ?? "");
    const doctorLocation = doctor.location?.toLowerCase() ?? "";
    const isOnline = doctor.availableOnline ?? doctor.location === "Online Only";

    const specialtyMatch = normalizedSpecialty === "all" || doctorSpecialty.includes(normalizedSpecialty);
    const locationMatch = normalizedLocation === "" || doctorLocation.includes(normalizedLocation);
    const availabilityMatch = availability === "any" || (availability === "online" && isOnline);

    return specialtyMatch && locationMatch && availabilityMatch;
  });

  const filters = { specialty, location, availability };

  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Find a Doctor or Therapist</h1>
        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Browse our curated list of top-rated, verified health professionals.
        </p>
      </div>

      <div className="mb-8">
        <Suspense fallback={<Skeleton className="h-[164px] w-full rounded-xl" />}>
          <DoctorFilters filters={filters} />
        </Suspense>
      </div>

      {filteredDoctors.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDoctors.map((doctor: Doctor) => (
            <DoctorCard key={doctor.id} doctor={doctor} />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <h2 className="mb-2 text-2xl font-semibold">No Doctors Found</h2>
          <p className="text-muted-foreground">Try adjusting your filters to find more results.</p>
        </div>
      )}
    </AppShell>
  );
}

import type { Metadata } from "next";

import AppShell from "@/components/layout/app-shell";
import DoctorCard from "@/components/doctor-card";
import DoctorFilters from "@/components/doctor-filters";
import { getDoctorsAction } from "@/app/actions";
import type { Doctor } from "@/lib/types";

export const metadata: Metadata = {
  title: "Find a Doctor | MyHealthApp",
  description:
    "Browse our curated list of top-rated, verified health professionals.",
};

interface DoctorsPageProps {
  searchParams: Promise<{
    specialty?: string | string[];
    location?: string | string[];
    availability?: string | string[];
  }>;
}

const normalizeParam = (
  value: string | string[] | undefined
): string => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
};

export default async function DoctorsPage({
  searchParams,
}: DoctorsPageProps) {
  const [params, doctorsResponse] = await Promise.all([
    searchParams,
    getDoctorsAction(),
  ]);

  /*
   * getDoctorsAction returns an ActionResponse<Doctor[]>.
   *
   * Only use the returned data when the action succeeded.
   * This avoids assuming that every ActionResponse contains
   * usable doctor data.
   */
  const doctors: Doctor[] =
    doctorsResponse.success && Array.isArray(doctorsResponse.data)
      ? doctorsResponse.data
      : [];

  const specialty = normalizeParam(params.specialty) || "all";
  const location = normalizeParam(params.location);
  const availability = normalizeParam(params.availability) || "any";

  const normalizedSpecialty = specialty.toLowerCase();
  const normalizedLocation = location.toLowerCase();

  const filteredDoctors = doctors.filter(
    (doctor: Doctor): boolean => {
      const doctorSpecialty = doctor.specialty?.toLowerCase() ?? "";
      const doctorLocation = doctor.location?.toLowerCase() ?? "";

      const specialtyMatch =
        normalizedSpecialty === "all" ||
        doctorSpecialty.includes(normalizedSpecialty);

      const locationMatch =
        normalizedLocation === "" ||
        doctorLocation.includes(normalizedLocation);

      const availabilityMatch =
        availability === "any" ||
        (availability === "online" &&
          doctor.location === "Online Only");

      return (
        specialtyMatch &&
        locationMatch &&
        availabilityMatch
      );
    }
  );

  const filters = {
    specialty,
    location,
    availability,
  };

  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Find a Doctor or Therapist
        </h1>

        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Browse our curated list of top-rated, verified health
          professionals.
        </p>
      </div>

      <div className="mb-8">
        <DoctorFilters filters={filters} />
      </div>

      {filteredDoctors.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDoctors.map((doctor: Doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={doctor}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <h2 className="mb-2 text-2xl font-semibold">
            No Doctors Found
          </h2>

          <p className="text-muted-foreground">
            Try adjusting your filters to find more results.
          </p>
        </div>
      )}
    </AppShell>
  );
}


import type { Metadata } from 'next';
import DoctorCard from "@/components/doctor-card";
import DoctorFilters from "@/components/doctor-filters";
import type { Doctor } from "@/lib/types";
import { getDoctorsAction } from '@/app/actions';
import AppShell from '@/components/layout/app-shell';

export const metadata: Metadata = {
    title: 'Find a Doctor | MyHealthApp',
    description: 'Browse our curated list of top-rated, verified health professionals.',
};

interface DoctorsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function DoctorsPage({ searchParams }: DoctorsPageProps) {
  const { data: doctors = [] } = await getDoctorsAction();
  
  const specialty = typeof searchParams.specialty === 'string' ? searchParams.specialty : 'all';
  const location = typeof searchParams.location === 'string' ? searchParams.location : '';
  const availability = typeof searchParams.availability === 'string' ? searchParams.availability : 'any';

  const filters = {
    specialty,
    location,
    availability,
  };

  const filteredDoctors = doctors.filter((doctor: Doctor) => {
    const specialtyMatch = filters.specialty === 'all' || doctor.specialty.toLowerCase().includes(filters.specialty.toLowerCase());
    const locationMatch = filters.location === '' || doctor.location.toLowerCase().includes(filters.location.toLowerCase());
    const availabilityMatch = filters.availability === 'any' || (filters.availability === 'online' && doctor.location === 'Online Only');
    
    return specialtyMatch && locationMatch && availabilityMatch;
  });

  return (
    <AppShell>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tight">Find a Doctor or Therapist</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Browse our curated list of top-rated, verified health professionals.
        </p>
      </div>

      <div className="mb-8">
        <DoctorFilters filters={filters} />
      </div>
        
      {filteredDoctors.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredDoctors.map((doctor) => (
            <DoctorCard key={doctor.id} doctor={doctor} />
            ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <h2 className="text-2xl font-semibold mb-2">No Doctors Found</h2>
          <p className="text-muted-foreground">Try adjusting your filters to find more results.</p>
        </div>
      )}
    </AppShell>
  );
}

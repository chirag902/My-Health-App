"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  Input,
} from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";

import {
  MapPin,
  RotateCcw,
  Search,
} from "lucide-react";

/* ============================================================
   TYPES
   ============================================================ */

interface DoctorFiltersProps {
  filters: {
    specialty: string;
    location: string;
    availability: string;
  };
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const LOCATION_DEBOUNCE_MS = 350;

const SPECIALTIES = [
  {
    value: "psychiatrist",
    label: "Psychiatrist",
  },
  {
    value: "therapist",
    label: "Therapist",
  },
  {
    value: "psychologist",
    label: "Psychologist",
  },
  {
    value: "neurologist",
    label: "Neurologist",
  },
  {
    value: "general-practitioner",
    label: "General Practitioner",
  },
  {
    value: "cardiologist",
    label: "Cardiologist",
  },
  {
    value: "dermatologist",
    label: "Dermatologist",
  },
  {
    value: "pediatrician",
    label: "Pediatrician",
  },
  {
    value: "oncologist",
    label: "Oncologist",
  },
  {
    value: "orthopedist",
    label: "Orthopedist",
  },
  {
    value: "gynecologist",
    label: "Gynecologist",
  },
  {
    value: "endocrinologist",
    label: "Endocrinologist",
  },
  {
    value: "gastroenterologist",
    label: "Gastroenterologist",
  },
  {
    value: "acupuncturist",
    label: "Acupuncturist",
  },
] as const;

/* ============================================================
   COMPONENT
   ============================================================ */

export default function DoctorFilters({
  filters,
}: DoctorFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isPending, startTransition] = useTransition();

  const [location, setLocation] = useState(
    filters.location ?? ""
  );

  const debounceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ==========================================================
     SYNC URL → LOCAL STATE
     ========================================================== */

  useEffect(() => {
    setLocation(filters.location ?? "");
  }, [filters.location]);

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /* ==========================================================
     NAVIGATION
     ========================================================== */

  const updateFilter = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(
        searchParams.toString()
      );

      const normalizedValue = value.trim();

      if (normalizedValue) {
        params.set(name, normalizedValue);
      } else {
        params.delete(name);
      }

      /**
       * Filters are state, not navigation history.
       *
       * replace() prevents every filter change from adding
       * another browser-history entry.
       */
      const queryString = params.toString();

      const target = queryString
        ? `${pathname}?${queryString}`
        : pathname;

      startTransition(() => {
        router.replace(target, {
          scroll: false,
        });
      });
    },
    [
      pathname,
      router,
      searchParams,
      startTransition,
    ]
  );

  /* ==========================================================
     SPECIALTY
     ========================================================== */

  const handleSpecialtyChange = useCallback(
    (value: string) => {
      updateFilter(
        "specialty",
        value === "all" ? "" : value
      );
    },
    [updateFilter]
  );

  /* ==========================================================
     AVAILABILITY
     ========================================================== */

  const handleAvailabilityChange = useCallback(
    (value: string) => {
      updateFilter(
        "availability",
        value === "any" ? "" : value
      );
    },
    [updateFilter]
  );

  /* ==========================================================
     LOCATION
     ========================================================== */

  const handleLocationChange = useCallback(
    (value: string) => {
      setLocation(value);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        updateFilter("location", value);
      }, LOCATION_DEBOUNCE_MS);
    },
    [updateFilter]
  );

  /* ==========================================================
     RESET
     ========================================================== */

  const handleReset = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setLocation("");

    /**
     * Remove only doctor-filter parameters.
     *
     * Other URL parameters remain untouched.
     */
    const params = new URLSearchParams(
      searchParams.toString()
    );

    params.delete("specialty");
    params.delete("location");
    params.delete("availability");

    const queryString = params.toString();

    const target = queryString
      ? `${pathname}?${queryString}`
      : pathname;

    startTransition(() => {
      router.replace(target, {
        scroll: false,
      });
    });
  }, [
    pathname,
    router,
    searchParams,
    startTransition,
  ]);

  /* ==========================================================
     ACTIVE FILTER STATE
     ========================================================== */

  const hasActiveFilters =
    Boolean(filters.specialty) ||
    Boolean(filters.location) ||
    Boolean(filters.availability);

  /* ==========================================================
     UI
     ========================================================== */

  return (
    <div
      className="
        rounded-xl border bg-card p-4 shadow-sm
        sm:p-5
      "
      aria-label="Doctor filters"
    >
      <div
        className="
          grid gap-4
          md:grid-cols-3
          md:items-end
        "
      >
        {/* ==================================================
            SPECIALTY
            ================================================== */}

        <div className="space-y-1.5">
          <label
            htmlFor="specialty"
            className="text-sm font-medium"
          >
            Specialty
          </label>

          <Select
            value={filters.specialty || "all"}
            onValueChange={handleSpecialtyChange}
            disabled={isPending}
          >
            <SelectTrigger
              id="specialty"
              aria-label="Filter by specialty"
            >
              <SelectValue placeholder="All Specialties" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">
                All Specialties
              </SelectItem>

              {SPECIALTIES.map((specialty) => (
                <SelectItem
                  key={specialty.value}
                  value={specialty.value}
                >
                  {specialty.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ==================================================
            LOCATION
            ================================================== */}

        <div className="space-y-1.5">
          <label
            htmlFor="location"
            className="text-sm font-medium"
          >
            Location
          </label>

          <div className="relative">
            <MapPin
              className="
                pointer-events-none
                absolute left-3 top-1/2
                h-4 w-4
                -translate-y-1/2
                text-muted-foreground
              "
              aria-hidden="true"
            />

            <Input
              id="location"
              type="search"
              inputMode="search"
              autoComplete="address-level2"
              placeholder="City, Country"
              value={location}
              onChange={(event) =>
                handleLocationChange(event.target.value)
              }
              disabled={isPending}
              className="pl-10 pr-10"
              aria-label="Search doctors by location"
            />

            <Search
              className="
                pointer-events-none
                absolute right-3 top-1/2
                h-4 w-4
                -translate-y-1/2
                text-muted-foreground
              "
              aria-hidden="true"
            />
          </div>
        </div>

        {/* ==================================================
            AVAILABILITY
            ================================================== */}

        <div className="space-y-1.5">
          <label
            htmlFor="availability"
            className="text-sm font-medium"
          >
            Availability
          </label>

          <Select
            value={filters.availability || "any"}
            onValueChange={handleAvailabilityChange}
            disabled={isPending}
          >
            <SelectTrigger
              id="availability"
              aria-label="Filter by availability"
            >
              <SelectValue placeholder="Any" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="any">
                Any
              </SelectItem>

              <SelectItem value="online">
                Online Only
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ======================================================
          FILTER FOOTER
          ====================================================== */}

      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
        <div
          className="text-xs text-muted-foreground"
          aria-live="polite"
        >
          {isPending
            ? "Updating results..."
            : hasActiveFilters
              ? "Filters applied"
              : "Showing all doctors"}
        </div>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isPending}
          >
            <RotateCcw
              className="mr-2 h-3.5 w-3.5"
              aria-hidden="true"
            />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
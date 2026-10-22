import type { Doctor } from "@/lib/types";

/** ⚠️ SAMPLE DATA. These are not real doctors. Label it in the UI or replace before launch. */
export const IS_MOCK_DIRECTORY = true;

type Row = [name: string, specialty: string, city: string, rating: number, reviews: number, online: boolean, bio: string];

const ROWS: Row[] = [
  ["Aisha Khan", "Psychiatrist", "Mumbai", 4.8, 142, true, "15+ years helping patients manage anxiety, depression, and mood disorders through evidence-based treatment."],
  ["Raj Mehta", "General Practitioner", "Delhi", 4.3, 87, false, "Focused on preventive care, chronic disease management, and routine health checkups for the whole family."],
  ["Dr. Priya Sharma", "Cardiologist", "Jaipur", 4.9, 216, true, "Focused on preventive cardiology, blood pressure management, heart health assessments, and cardiovascular risk reduction."],
  ["Dr. Arjun Patel", "Dermatologist", "Ahmedabad", 4.7, 163, true, "Provides dermatology consultations for acne, eczema, skin allergies, hair loss, and general skin health."],
  ["Dr. Neha Verma", "Pediatrician", "Lucknow", 4.8, 194, true, "Focused on childhood development, preventive pediatric care, vaccination guidance, and common childhood illnesses."],
  ["Dr. Rohan Desai", "Orthopedic Surgeon", "Pune", 4.6, 128, false, "Specializes in musculoskeletal conditions, joint health, sports injuries, and orthopedic rehabilitation planning."],
  ["Dr. Ananya Iyer", "Gynecologist", "Chennai", 4.9, 237, true, "Provides women's health consultations, menstrual health guidance, reproductive health counseling, and preventive screenings."],
  ["Dr. Vikram Singh", "Neurologist", "Chandigarh", 4.7, 151, true, "Focused on evaluating headaches, migraine, nerve disorders, movement-related symptoms, and neurological conditions."],
  ["Dr. Meera Nair", "Endocrinologist", "Kochi", 4.8, 176, true, "Helps patients manage diabetes, thyroid disorders, hormonal imbalances, and other endocrine health conditions."],
  ["Dr. Karan Malhotra", "Gastroenterologist", "New Delhi", 4.6, 119, false, "Focused on digestive health, acid reflux, abdominal symptoms, liver health, and gastrointestinal disorders."],
  ["Dr. Sneha Kulkarni", "Ophthalmologist", "Nagpur", 4.8, 142, true, "Provides eye health assessments, vision care, screening for common eye conditions, and guidance on eye protection."],
  ["Dr. Aditya Rao", "ENT Specialist", "Hyderabad", 4.7, 108, true, "Evaluates ear, nose, and throat concerns, including sinus symptoms, hearing difficulties, allergies, and voice problems."],
  ["Dr. Kavya Reddy", "Pulmonologist", "Bengaluru", 4.9, 203, true, "Focused on respiratory health, asthma management, persistent cough, breathing difficulties, and lung disease evaluation."],
  ["Dr. Saurabh Joshi", "Urologist", "Indore", 4.5, 96, false, "Provides consultations for urinary tract concerns, kidney stone evaluation, prostate health, and common urological conditions."],
  ["Dr. Pooja Banerjee", "Oncologist", "Kolkata", 4.8, 184, true, "Supports cancer evaluation and treatment planning, symptom management, and coordination of multidisciplinary cancer care."],
  ["Dr. Manish Gupta", "Nephrologist", "Bhopal", 4.6, 113, true, "Focused on kidney health, chronic kidney disease management, blood pressure-related kidney concerns, and renal care."],
  ["Dr. Ishita Bose", "Nutritionist", "Kolkata", 4.7, 167, true, "Creates practical nutrition plans for balanced eating, healthy weight management, and nutrition-related lifestyle goals."],
  ["Dr. Nikhil Chawla", "Physiotherapist", "Gurugram", 4.8, 155, true, "Focuses on mobility, posture, injury recovery, pain management strategies, and personalized rehabilitation exercises."],
  ["Dr. Simran Kaur", "Psychologist", "Amritsar", 4.9, 221, true, "Offers psychological counseling focused on stress management, emotional well-being, coping strategies, and personal growth."],
  ["Dr. Abhishek Mishra", "Pulmonologist", "Varanasi", 4.5, 89, false, "Provides respiratory consultations for chronic cough, asthma symptoms, sleep-related breathing concerns, and lung health."],
  ["Dr. Ritu Menon", "Rheumatologist", "Thiruvananthapuram", 4.8, 132, true, "Focused on joint inflammation, autoimmune conditions, arthritis evaluation, and long-term musculoskeletal health."],
  ["Dr. Varun Kapoor", "Dentist", "Ludhiana", 4.6, 147, true, "Provides preventive dental care, oral hygiene guidance, routine dental assessments, and common dental treatment planning."],
  ["Dr. Tanvi Shah", "General Practitioner", "Surat", 4.7, 126, true, "Focused on primary care, routine health assessments, common illnesses, preventive screenings, and ongoing wellness support."],
  ["Dr. Devendra Rathore", "Geriatrician", "Jodhpur", 4.8, 101, false, "Supports older adults with preventive care, medication review coordination, mobility concerns, and age-related health needs."],
  ["Dr. Farah Siddiqui", "Allergist and Immunologist", "Bengaluru", 4.7, 118, true, "Evaluates allergic reactions, seasonal allergies, asthma-related triggers, and selected immune system conditions."],
  ["Dr. Akash Sinha", "Radiologist", "Patna", 4.6, 94, false, "Focused on diagnostic imaging interpretation and supporting clinical teams with imaging-based evaluations."],
  ["Dr. Nandita Das", "Sleep Medicine Specialist", "Bhubaneswar", 4.8, 139, true, "Helps evaluate sleep difficulties, insomnia symptoms, sleep routines, and concerns that may affect restorative sleep."],
  ["Sana Verma", "Therapist", "Bengaluru", 4.9, 203, true, "Specializes in CBT and trauma-informed therapy for young adults navigating stress and burnout."],
];

export const MOCK_DOCTORS: Doctor[] = ROWS.map(
  ([name, specialty, city, rating, reviews, availableOnline, bio], i) => ({
    id: `doc-${i + 1}`,
    name,
    avatar: null,
    specialty,
    rating,
    reviews,
    location: `${city}, India`,
    bio,
    availableOnline,
  })
);

/** Single source of truth for the AI's `suggestedSpecialty` allowlist. */
export const DOCTOR_SPECIALTIES: string[] = [...new Set(MOCK_DOCTORS.map((d) => d.specialty))].sort();
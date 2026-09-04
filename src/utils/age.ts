// Age is always derived from birth_date at read/query time, never stored.

export function calculateAge(birthDate: Date | string): number {
  const dob = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// Converts an [minAge, maxAge] filter into a birth_date range usable in a Mongo query.
export function ageRangeToBirthDateFilter(
  minAge?: number,
  maxAge?: number
): { $gte?: Date; $lte?: Date } | undefined {
  if (minAge === undefined && maxAge === undefined) return undefined;

  const filter: { $gte?: Date; $lte?: Date } = {};

  // age >= minAge  =>  birth_date <= (today - minAge years)
  if (minAge !== undefined) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - minAge);
    filter.$lte = d;
  }

  // age <= maxAge  =>  birth_date >= (today - (maxAge + 1) years + 1 day)
  if (maxAge !== undefined) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - maxAge - 1);
    d.setDate(d.getDate() + 1);
    filter.$gte = d;
  }

  return filter;
}

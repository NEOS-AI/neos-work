type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v) return;
    if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) v.forEach(walk);
  };
  inputs.forEach(walk);
  return out.join(" ");
}

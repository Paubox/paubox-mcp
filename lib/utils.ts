import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine multiple class values into a single string.  This helper
 * leverages the `clsx` library to conditionally join class names
 * together and `tailwind-merge` to resolve conflicting Tailwind
 * utility classes.  Use this instead of manually concatenating class
 * names to ensure your styles are applied correctly.
 *
 * @param inputs - One or more class values that can be strings,
 *                 objects, arrays, or other types supported by clsx.
 * @returns A space-delimited string of classes with duplicates
 *          removed and Tailwind conflicts resolved.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
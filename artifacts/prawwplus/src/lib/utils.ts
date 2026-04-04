import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #a855f7, #7c3aed)",
  "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  "linear-gradient(135deg, #06b6d4, #0284c7)",
  "linear-gradient(135deg, #10b981, #059669)",
  "linear-gradient(135deg, #f59e0b, #d97706)",
  "linear-gradient(135deg, #ef4444, #dc2626)",
  "linear-gradient(135deg, #ec4899, #db2777)",
  "linear-gradient(135deg, #f97316, #ea580c)",
  "linear-gradient(135deg, #8b5cf6, #6d28d9)",
  "linear-gradient(135deg, #14b8a6, #0d9488)",
];

export function avatarGradient(seed: string): string {
  const hash = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amount);
}

export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

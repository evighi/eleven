"use client";

type Props = {
  /** ex.: "w-6 h-6" | "w-8 h-8" */
  size?: string;
  /** ex.: "border-2" | "border-4" */
  stroke?: string;
  className?: string;
  label?: string;
};

export default function Spinner({
  size = "w-6 h-6",
  stroke = "border-2",
  className = "",
  label = "Carregando",
}: Props) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin rounded-full ${stroke} border-gray-300 border-t-orange-600 ${size} ${className}`}
    />
  );
}

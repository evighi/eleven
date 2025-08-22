// Retorna "YYYY-MM-DD" na data LOCAL do usuário (ou da zona passada)
export function isoLocalDate(date = new Date(), timeZone?: string) {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, // se não passar, usa o fuso do dispositivo (ótimo para o cliente)
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

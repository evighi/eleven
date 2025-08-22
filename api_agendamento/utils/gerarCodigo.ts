export function gerarCodigoVerificacao(): string {
  return Math.floor(100000 + Math.random() * 900000).toString(); // ex: "548392"
}

// src/utils/enviarEmail.ts
import nodemailer from "nodemailer";
import { Resend } from "resend";

const provider = (process.env.EMAIL_PROVIDER || "").toLowerCase();

function isResendEnabled() {
  // prioriza flag explícita, senão cai na presença da API key
  if (provider === "resend") return !!process.env.RESEND_API_KEY;
  if (provider === "mailtrap") return false;
  return !!process.env.RESEND_API_KEY;
}

const DEFAULT_FROM = process.env.RESEND_FROM || "Eleven Sports <no-reply@elevensportsoficial.com.br>";

/* ========================= TEMPLATES ========================= */
function tplBase({
  titulo,
  intro,
  codigo,
  rodape,
}: {
  titulo: string;
  intro: string;
  codigo: string;
  rodape?: string;
}) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto">
      <div style="text-align:center;margin:20px 0"></div>
      <h2 style="color:#ea580c;margin:0 0 8px">${titulo}</h2>
      <p>${intro}</p>
      <div style="font-size:28px;letter-spacing:4px;font-weight:700;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;text-align:center;margin:16px 0">
        ${codigo}
      </div>
      ${rodape ? `<p style="color:#6b7280;font-size:12px">${rodape}</p>` : ""}
    </div>
  `;
}

function tplVerificacao(codigo: string) {
  return tplBase({
    titulo: "Seu código de verificação",
    intro: "Use o código abaixo para confirmar seu e-mail:",
    codigo,
    rodape: "Se você não solicitou este cadastro, ignore esta mensagem.",
  });
}

function tplRecuperacao(codigo: string, ttlMin: number) {
  return tplBase({
    titulo: "Código de recuperação de senha",
    intro: "Use o código abaixo para redefinir a sua senha:",
    codigo,
    rodape: `Este código é válido por ${ttlMin} minuto(s). Se você não solicitou a recuperação, ignore este e-mail.`,
  });
}

/* ========================= ENVIO ========================= */
async function sendViaResend(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to: [to],
    subject,
    html,
  });

  if (error) {
    console.error("[email][resend] erro:", error);
    throw new Error(error.message);
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`[email] enviado via Resend → ${to} | ${subject}`);
  }
}

async function sendViaMailtrap(to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 2525),
    auth: {
      user: process.env.MAIL_USER!,
      pass: process.env.MAIL_PASS!,
    },
  });

  await transporter.sendMail({
    from: '"Eleven Sports" <no-reply@elevensportsoficial.com.br>',
    to,
    subject,
    html,
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[email] enviado via Mailtrap → ${to} | ${subject}`);
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  if (isResendEnabled()) return sendViaResend(to, subject, html);
  return sendViaMailtrap(to, subject, html);
}

/* ========================= EXPOSTAS ========================= */
// (já usada no cadastro)
export async function enviarCodigoEmail(destinatario: string, codigo: string) {
  const subject = "Código de verificação de e-mail";
  const html = tplVerificacao(codigo);
  await sendEmail(destinatario, subject, html);
}

// (nova) para recuperação de senha
export async function enviarCodigoRecuperacao(destinatario: string, codigo: string, ttlMin?: number) {
  const ttl = Number(process.env.RECUP_SENHA_TTL_MIN || 15);
  const subject = "Código de recuperação de senha";
  const html = tplRecuperacao(codigo, ttlMin ?? ttl);
  await sendEmail(destinatario, subject, html);
}

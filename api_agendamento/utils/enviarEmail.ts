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

export async function enviarCodigoEmail(destinatario: string, codigo: string) {
  if (isResendEnabled()) {
    // ===== Resend =====
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const from =
      process.env.RESEND_FROM || "Eleven Sports <no-reply@elevensportsoficial.com.br>";

    const { error } = await resend.emails.send({
      from,
      to: [destinatario],
      subject: "Código de verificação de e-mail",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto">
          <div style="text-align:center;margin:20px 0">
          </div>
          <h2 style="color:#ea580c;margin:0 0 8px">Seu código de verificação</h2>
          <p>Use o código abaixo para confirmar seu e-mail:</p>
          <div style="font-size:28px;letter-spacing:4px;font-weight:700;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;text-align:center;margin:16px 0">
            ${codigo}
          </div>
          <p style="color:#6b7280;font-size:12px">
            Se você não solicitou este cadastro, ignore esta mensagem.
          </p>
        </div>
      `,
    });

    if (error) {
      // Deixe um log útil em dev
      console.error("[email][resend] erro:", error);
      throw new Error(error.message);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[email] enviado via Resend →", destinatario);
    }
    return;
  }

  // ===== Mailtrap (nodemailer) =====
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 2525),
    auth: {
      user: process.env.MAIL_USER!,
      pass: process.env.MAIL_PASS!,
    },
  });

  const mailOptions = {
    from: '"Eleven Sports" <no-reply@elevensportsoficial.com.br>',
    to: destinatario,
    subject: "Código de verificação de e-mail",
    html: `<p>Seu código de verificação é: <strong>${codigo}</strong></p>`,
  };

  await transporter.sendMail(mailOptions);

  if (process.env.NODE_ENV !== "production") {
    console.log("[email] enviado via Mailtrap →", destinatario);
  }
}

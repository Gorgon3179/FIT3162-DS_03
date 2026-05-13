// Supabase Edge Function — send verification email via Brevo SMTP
// Deploy via Supabase Dashboard → Edge Functions → Create Function
// Set secrets in Dashboard: BREVO_SMTP_HOST, BREVO_SMTP_USER, BREVO_SMTP_KEY, BREVO_FROM_EMAIL

import { createTransport } from "npm:nodemailer@6.9.14";

Deno.serve(async (req) => {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return new Response(
        JSON.stringify({ error: "Email and code are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const transporter = createTransport({
      host: Deno.env.get("BREVO_SMTP_HOST") || "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: Deno.env.get("BREVO_SMTP_USER"),
        pass: Deno.env.get("BREVO_SMTP_KEY"),
      },
    });

    await transporter.sendMail({
      from: `"MonashVote" <${Deno.env.get("BREVO_FROM_EMAIL")}>`,
      to: email,
      subject: "Your MonashVote verification code",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
          <h2 style="color:#002a5c;">MonashVote</h2>
          <p>Your verification code is:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#006dae;margin:24px 0;">${code}</div>
          <p style="color:#666;">This code expires in 10 minutes.</p>
          <p style="color:#666;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// api/recuperar-senha.js
const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, params) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey':        SB_SERVICE_KEY,
      'Authorization': `Bearer ${SB_SERVICE_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(params)
  });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function enviarEmailResend(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from: 'JBX Sports <suporte@jbxsports.com.br>',
      to,
      subject,
      html
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { acao, cpf, codigo, senha_nova } = req.body;

  // ── AÇÃO 1: Solicitar código ──
  if (acao === 'solicitar') {
    try {
      const dados = await rpc('solicitar_recuperacao', { p_cpf: cpf });

      if (!dados.ok) {
        return res.status(200).json({ ok: false, erro: dados.erro });
      }

      await enviarEmailResend(
        dados.email,
        'Código de recuperação de senha — JBX Sports',
        `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#171717;border-radius:12px;border:1px solid rgba(255,117,31,0.2);overflow:hidden;">
        <tr>
          <td style="background:#ff751f;padding:28px 40px;text-align:center;">
            <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">JBX SPORTS</div>
            <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">Recuperação de senha</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="color:#ffffff;font-size:16px;margin:0 0 8px;">Olá, <strong>${dados.nome}</strong>!</p>
            <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0 0 32px;line-height:1.6;">
              Recebemos uma solicitação para redefinir a senha da sua conta JBX Sports.<br>
              Use o código abaixo para continuar:
            </p>
            <div style="background:#0a0a0a;border:2px solid #ff751f;border-radius:10px;padding:24px;text-align:center;margin-bottom:32px;">
              <div style="color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Seu código</div>
              <div style="color:#ff751f;font-size:42px;font-weight:700;letter-spacing:10px;">${dados.codigo}</div>
              <div style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:12px;">⏱ Válido por 15 minutos</div>
            </div>
            <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;margin:0;">
              Se você não solicitou a recuperação de senha, ignore este e-mail.<br>
              Sua senha permanece a mesma.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="color:rgba(255,255,255,0.25);font-size:12px;margin:0;">
              © 2026 JBX Sports · jbx-sports.vercel.app
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
      );

      return res.status(200).json({
        ok: true,
        email_mascarado: dados.email_mascarado
      });

    } catch (err) {
      console.error('[recuperar-senha] Erro solicitar:', err);
      return res.status(500).json({ ok: false, erro: 'Erro interno ao enviar e-mail' });
    }
  }

  // ── AÇÃO 2: Redefinir senha ──
  if (acao === 'redefinir') {
    try {
      const dados = await rpc('redefinir_senha', {
        p_cpf:        cpf,
        p_codigo:     codigo,
        p_senha_nova: senha_nova
      });
      return res.status(200).json(dados);
    } catch (err) {
      console.error('[recuperar-senha] Erro redefinir:', err);
      return res.status(500).json({ ok: false, erro: 'Erro interno' });
    }
  }

  return res.status(400).json({ ok: false, erro: 'Ação inválida' });
};

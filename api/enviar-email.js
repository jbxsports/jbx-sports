const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'JBX Sports <suporte@jbxsports.com.br>';

// ── Template base ──
function templateBase(conteudo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#171717;border-radius:12px;border:1px solid rgba(255,117,31,0.2);overflow:hidden;max-width:560px;">
        <!-- Header -->
        <tr>
          <td style="background:#ff751f;padding:28px 40px;text-align:center;">
            <div style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">JBX SPORTS</div>
            <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">Eventos Esportivos</div>
          </td>
        </tr>
        <!-- Conteúdo -->
        <tr><td style="padding:40px;">${conteudo}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="color:rgba(255,255,255,0.25);font-size:12px;margin:0 0 4px;">© 2026 JBX Sports · Todos os direitos reservados</p>
            <p style="color:rgba(255,255,255,0.15);font-size:11px;margin:0;">jbx-sports.vercel.app</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── E-mail 1: Boas-vindas (cadastro) ──
function htmlBoasVindas(nome) {
  const primeiroNome = (nome || 'Atleta').split(' ')[0];
  return templateBase(`
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:52px;margin-bottom:16px;">🎽</div>
      <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0 0 8px;">Bem-vindo à JBX Sports!</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:15px;margin:0;">Sua conta foi criada com sucesso</p>
    </div>
    <p style="color:#ffffff;font-size:16px;margin:0 0 16px;">Olá, <strong>${primeiroNome}</strong>!</p>
    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.8;margin:0 0 28px;">
      Sua conta na <strong style="color:#ff751f;">JBX Sports</strong> foi criada com sucesso. Agora você pode se inscrever nos nossos eventos com muito mais rapidez — seus dados já estarão salvos!
    </p>
    <div style="background:#0a0a0a;border-left:3px solid #ff751f;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
      <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:0 0 8px;font-weight:700;">Com sua conta você pode:</p>
      <p style="color:rgba(255,255,255,0.55);font-size:13px;margin:0;line-height:1.8;">
        ✅ Inscrever-se em eventos com 1 clique<br>
        ✅ Acompanhar todas as suas inscrições<br>
        ✅ Baixar seu QR Code de retirada de kit<br>
        ✅ Recuperar sua senha quando precisar
      </p>
    </div>
    <div style="text-align:center;">
      <a href="https://jbx-sports.vercel.app" style="display:inline-block;background:#ff751f;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;">Ver eventos disponíveis →</a>
    </div>
  `);
}

// ── E-mail 2: Confirmação de inscrição ──
function htmlConfirmacaoInscricao(item, dataEvento) {
  const primeiroNome = (item.nome || 'Atleta').split(' ')[0];
  const valor = item.valor ? 'R$ ' + Number(item.valor).toFixed(2).replace('.', ',') : '—';
  return templateBase(`
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:52px;margin-bottom:16px;">🏁</div>
      <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0 0 8px;">Inscrição confirmada!</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:15px;margin:0;">Pagamento aprovado com sucesso</p>
    </div>
    <p style="color:#ffffff;font-size:16px;margin:0 0 24px;">Olá, <strong>${primeiroNome}</strong>! Sua inscrição está confirmada. Vemos você na largada! 🧡</p>

    <!-- Card do evento -->
    <div style="background:#0a0a0a;border:1px solid rgba(255,117,31,0.25);border-radius:10px;overflow:hidden;margin-bottom:28px;">
      <div style="background:rgba(255,117,31,0.12);padding:12px 20px;border-bottom:1px solid rgba(255,117,31,0.15);">
        <p style="color:#ff751f;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;">Detalhes da inscrição</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:8px 0;">
        ${linhaDetalhe('Evento', item.evento || '—')}
        ${linhaDetalhe('Data', dataEvento || '—')}
        ${linhaDetalhe('Modalidade', item.modalidade || '—')}
        ${linhaDetalhe('Kit', item.kit || '—')}
        ${linhaDetalhe('Camiseta', item.tamanho_camisa || '—')}
        ${linhaDetalhe('Valor pago', valor, true)}
      </table>
    </div>

    <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px 20px;margin-bottom:28px;">
      <p style="color:#22c55e;font-size:13px;margin:0;line-height:1.7;">
        📍 <strong>Retirada do kit:</strong> Fique de olho nas nossas redes sociais para informações sobre local e horário de retirada do kit.<br>
        📸 <strong>@jbx.sports</strong>
      </p>
    </div>

    <div style="text-align:center;">
      <a href="https://jbx-sports.vercel.app/atleta.html" style="display:inline-block;background:#ff751f;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;">Ver minha inscrição →</a>
    </div>
  `);
}

function linhaDetalhe(label, valor, destaque = false) {
  return `
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="color:rgba(255,255,255,0.45);font-size:13px;">${label}</span>
      </td>
      <td style="padding:10px 20px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;">
        <span style="color:${destaque ? '#ff751f' : 'rgba(255,255,255,0.9)'};font-size:13px;font-weight:${destaque ? '700' : '600'};">${valor}</span>
      </td>
    </tr>`;
}

// ── Handler ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { tipo, email, nome, item, data_evento } = req.body;

  try {
    if (tipo === 'boas_vindas') {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject: `Bem-vindo à JBX Sports, ${(nome || '').split(' ')[0]}! 🎽`,
        html: htmlBoasVindas(nome)
      });
      return res.status(200).json({ ok: true });
    }

    if (tipo === 'confirmacao_inscricao') {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject: `Inscrição confirmada — ${item?.evento || 'JBX Sports'} 🏁`,
        html: htmlConfirmacaoInscricao(item, data_evento)
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, erro: 'Tipo inválido' });

  } catch (err) {
    console.error('[enviar-email] Erro:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno ao enviar e-mail' });
  }
};

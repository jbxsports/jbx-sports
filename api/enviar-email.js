// api/enviar-email.js
// Segurança (08/10/2026):
//  • confirmação, recusa e carrinho abandonado só saem com o cabeçalho
//    x-chave-interna = EMAIL_INTERNAL_KEY (variável de ambiente da Vercel).
//    Só o checkout, o webhook e o banco conhecem essa chave.
//  • boas-vindas (chamado pela área do atleta) só sai para e-mail que já tem
//    conta, e o nome vem do banco — nada do pedido entra no e-mail.
//  • todo texto é escapado antes de entrar no HTML.
const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CHAVE_INTERNA  = process.env.EMAIL_INTERNAL_KEY || '';
const ORIGENS_OK     = ['https://jbxsports.com.br', 'https://www.jbxsports.com.br', 'https://jbx-sports.vercel.app'];

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function emailValido(e) {
  return typeof e === 'string' && e.length <= 120 && /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(e);
}
function chaveConfere(req) {
  const h = String(req.headers['x-chave-interna'] || '');
  return CHAVE_INTERNA.length >= 20 && h === CHAVE_INTERNA;
}
async function contaPorEmail(email) {
  if (!SB_SERVICE_KEY) return null;
  try {
    const r = await fetch(SB_URL + '/rest/v1/atletas_contas?email=eq.' + encodeURIComponent(email) + '&select=nome&limit=1', {
      headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY }
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (e) { return null; }
}

async function enviarResend(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
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
  const primeiroNome = esc((nome || 'Atleta').split(' ')[0]);
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
  const primeiroNome = esc((item.nome || 'Atleta').split(' ')[0]);
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
        <span style="color:${destaque ? '#ff751f' : 'rgba(255,255,255,0.9)'};font-size:13px;font-weight:${destaque ? '700' : '600'};">${esc(valor)}</span>
      </td>
    </tr>`;
}


// ── E-mail 3: Pagamento recusado ──
function htmlPagamentoRecusado(nome, eventoNome, motivo) {
  const primeiroNome = esc((nome || 'Atleta').split(' ')[0]);
  eventoNome = esc(eventoNome); motivo = esc(motivo);
  return templateBase(`
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:52px;margin-bottom:16px;">❌</div>
      <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0 0 8px;">Pagamento não aprovado</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:15px;margin:0;">Sua inscrição não foi realizada</p>
    </div>
    <p style="color:#ffffff;font-size:16px;margin:0 0 20px;">Olá, <strong>${primeiroNome}</strong>.</p>
    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.8;margin:0 0 24px;">
      Infelizmente seu pagamento para o evento <strong style="color:#ff751f;">${eventoNome || 'JBX Sports'}</strong> não foi aprovado e sua inscrição <strong>não foi confirmada</strong>.
    </p>

    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:16px 20px;margin-bottom:28px;">
      <p style="color:rgba(255,255,255,0.5);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Motivo</p>
      <p style="color:#ef4444;font-size:14px;font-weight:600;margin:0;">${motivo || 'Pagamento recusado pelo banco.'}</p>
    </div>

    <div style="background:#0a0a0a;border-left:3px solid #ff751f;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
      <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:0 0 10px;font-weight:700;">O que fazer agora?</p>
      <p style="color:rgba(255,255,255,0.55);font-size:13px;margin:0;line-height:1.9;">
        ✅ Verifique os dados do cartão (número, validade, CVV)<br>
        ✅ Confirme o limite disponível com seu banco<br>
        ✅ Tente realizar a inscrição novamente com outro cartão<br>
        ✅ Em caso de dúvidas, entre em contato com seu banco
      </p>
    </div>

    <div style="text-align:center;">
      <a href="https://jbx-sports.vercel.app" style="display:inline-block;background:#ff751f;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;">Tentar novamente →</a>
    </div>

    <p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;margin-top:24px;">
      Dúvidas? Fale com a gente no Instagram <strong>@jbx.sports</strong>
    </p>
  `);
}

// ── E-mail 4: Carrinho abandonado ──
// Disparado pelo banco (função disparar_abandono_carrinho, cron a cada 30 min),
// 30 a 60 minutos depois de uma inscrição ficar pendente. Um por inscrição —
// a trava é a coluna abandono_notificado.
function htmlCarrinhoAbandonado(nome, item) {
  const primeiroNome = esc((nome || 'Atleta').split(' ')[0]);
  const evento = esc((item && item.evento) || 'JBX Sports');
  const linha = (label, valor) => valor
    ? `<tr><td style="padding:9px 20px;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="color:rgba(255,255,255,0.45);font-size:13px;">${label}</span></td><td style="padding:9px 20px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;"><span style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:600;">${esc(valor)}</span></td></tr>`
    : '';
  return templateBase(`
    <div style="text-align:center;margin-bottom:30px;">
      <div style="font-size:52px;margin-bottom:16px;">⏳</div>
      <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0 0 8px;">Sua inscrição ficou pela metade</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:15px;margin:0;">Falta só o pagamento para garantir sua vaga</p>
    </div>
    <p style="color:#ffffff;font-size:16px;margin:0 0 16px;">Olá, <strong>${primeiroNome}</strong>!</p>
    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.8;margin:0 0 26px;">
      Você começou sua inscrição no <strong style="color:#ff751f;">${evento}</strong>, mas o pagamento não chegou a ser concluído.
      Sua vaga <strong>ainda não está garantida</strong> — e as vagas de cada lote são limitadas.
    </p>

    <div style="background:#0a0a0a;border:1px solid rgba(255,117,31,0.25);border-radius:10px;overflow:hidden;margin-bottom:26px;">
      <div style="background:rgba(255,117,31,0.12);padding:12px 20px;border-bottom:1px solid rgba(255,117,31,0.15);">
        <p style="color:#ff751f;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;">Inscrição em aberto</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:8px 0;">
        ${linha('Evento', evento)}
        ${linha('Modalidade', item && item.modalidade)}
        ${linha('Kit', item && item.kit)}
      </table>
    </div>

    <div style="text-align:center;">
      <a href="https://jbxsports.com.br" style="display:inline-block;background:#ff751f;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;">Concluir minha inscrição →</a>
    </div>

    <p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;margin-top:26px;line-height:1.7;">
      Teve algum problema no pagamento? Fale com a gente no Instagram <strong>@jbx.sports</strong>.<br>
      Se você já concluiu ou não tem mais interesse, é só ignorar este e-mail.
    </p>
  `);
}

// ── Handler ──
module.exports = async (req, res) => {
  const origem = String(req.headers.origin || '');
  if (ORIGENS_OK.indexOf(origem) !== -1) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { tipo, email, nome, item, data_evento } = req.body || {};
  if (!emailValido(email)) return res.status(400).json({ ok: false, erro: 'E-mail inválido' });

  try {
    // Público (área do atleta): só para quem já tem conta; nome vem do banco.
    if (tipo === 'boas_vindas') {
      const conta = await contaPorEmail(email);
      if (!conta) return res.status(200).json({ ok: true }); // não revela se existe
      const n = conta.nome || 'Atleta';
      await enviarResend(email, 'Bem-vindo à JBX Sports, ' + n.split(' ')[0] + '! 🎽', htmlBoasVindas(n));
      return res.status(200).json({ ok: true });
    }

    // Daqui para baixo: só o próprio servidor (checkout, webhook, banco).
    if (!chaveConfere(req)) {
      console.warn('[enviar-email] chamada sem chave interna recusada — tipo:', tipo);
      return res.status(403).json({ ok: false, erro: 'Não autorizado' });
    }

    if (tipo === 'confirmacao_inscricao') {
      await enviarResend(email, `Inscrição confirmada — ${item?.evento || 'JBX Sports'} 🏁`, htmlConfirmacaoInscricao(item || {}, data_evento));
      return res.status(200).json({ ok: true });
    }

    if (tipo === 'carrinho_abandonado') {
      await enviarResend(email, `Falta pouco para garantir sua vaga — ${item?.evento || 'JBX Sports'} ⏳`, htmlCarrinhoAbandonado(nome, item));
      return res.status(200).json({ ok: true });
    }

    if (tipo === 'pagamento_recusado') {
      const { evento_nome, motivo } = req.body;
      await enviarResend(email, `Pagamento não aprovado — ${evento_nome || 'JBX Sports'} ❌`, htmlPagamentoRecusado(nome, evento_nome, motivo));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, erro: 'Tipo inválido' });

  } catch (err) {
    console.error('[enviar-email] Erro:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno ao enviar e-mail' });
  }
};

// api/mp-webhook.js — Mercado Pago Webhook
const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const ZAPI_INSTANCE     = '3F457758AC68513DE147E6B1C9468980';
const ZAPI_TOKEN        = 'CD007B54BA8BD1111B802279';
const ZAPI_CLIENT_TOKEN = 'Fbe7af069c70a4f1281ad63eee20c5cbeS';
const ZAPI_URL          = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL       = process.env.SITE_URL || 'https://jbx-sports.vercel.app';

// ── WhatsApp ──
async function enviarWhatsApp(telefone, mensagem) {
  try {
    let digits = telefone.replace(/[^0-9]/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 10) digits = digits.slice(0, 2) + '9' + digits.slice(2);
    const numero = '55' + digits;
    const res = await fetch(ZAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: numero, message: mensagem })
    });
    const respText = await res.text();
    console.log('[mp-webhook] WhatsApp enviado para', numero.slice(0,6) + '****', '| status:', res.status, '| resp:', respText.slice(0,100));
  } catch(e) {
    console.error('[mp-webhook] Erro Z-API:', e.message);
  }
}

// ── E-mail confirmação ──
async function enviarEmailConfirmacao(email, nome, item, dataEvento) {
  if (!email) return;
  try {
    const r = await fetch(`${SITE_URL}/api/enviar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'confirmacao_inscricao', email, nome, item, data_evento: dataEvento })
    });
    console.log('[mp-webhook] E-mail confirmação status:', r.status, 'para', email.slice(0,4) + '***');
  } catch(e) {
    console.error('[mp-webhook] Erro e-mail confirmação:', e.message);
  }
}

// ── E-mail recusa ──
async function enviarEmailRecusa(email, nome, eventoNome, motivo) {
  if (!email) return;
  try {
    const r = await fetch(`${SITE_URL}/api/enviar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'pagamento_recusado', email, nome, evento_nome: eventoNome, motivo })
    });
    console.log('[mp-webhook] E-mail recusa status:', r.status, 'para', email.slice(0,4) + '***');
  } catch(e) {
    console.error('[mp-webhook] Erro e-mail recusa:', e.message);
  }
}

// ── Supabase: confirmar pagamento com forma real ──
async function marcarComoPago(pedido, formaPagamento) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/confirmar_pagamento`, {
      method: 'POST',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_pedido: pedido, p_forma_pagamento: formaPagamento })
    });
    const text = await res.text();
    console.log('[mp-webhook] confirmar_pagamento status:', res.status, '| forma:', formaPagamento, text);
  } catch(e) {
    console.error('[mp-webhook] Erro confirmar_pagamento:', e.message);
  }
}

// ── Supabase: baixa de estoque dos produtos adicionais (pagamento aprovado) ──
async function baixarEstoque(pedido) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/baixar_estoque_pedido`, {
      method: 'POST',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ p_pedido: pedido })
    });
    const text = await res.text();
    console.log('[mp-webhook] baixar_estoque_pedido status:', res.status, text.slice(0,100));
  } catch(e) {
    console.error('[mp-webhook] Erro baixar_estoque_pedido:', e.message);
  }
}

// ── Supabase: deletar inscrições do pedido (pagamento recusado) ──
async function deletarInscricoesPedido(pedido) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/inscricoes?pedido_id=eq.${pedido}`, {
      method: 'DELETE',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json'
      }
    });
    console.log('[mp-webhook] deletar inscrições recusadas — pedido:', pedido, '| status:', res.status);
  } catch(e) {
    console.error('[mp-webhook] Erro deletar inscrições:', e.message);
  }
}

async function buscarEvento(eventoNome) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/eventos_publicos`, {
      method: 'POST',
      headers: { 'apikey': SB_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const eventos = await res.json();
    if (!Array.isArray(eventos)) return null;
    return eventos.find(e => e.nome === eventoNome) || null;
  } catch(e) { return null; }
}

function formatarData(dataStr, hora) {
  if (!dataStr) return '—';
  const d = new Date(dataStr + 'T12:00:00');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}${hora ? ' · ' + hora : ''}`;
}

// ── Detectar forma de pagamento real do MP ──
function detectarFormaPagamento(payment) {
  const tipo   = (payment.payment_type_id  || '').toLowerCase();
  const metodo = (payment.payment_method_id || '').toLowerCase();
  if (tipo === 'account_money') return 'Mercado Pago';
  if (tipo === 'bank_transfer' || metodo === 'pix') return 'PIX';
  if (tipo === 'credit_card')  return 'Cartão de crédito';
  if (tipo === 'debit_card')   return 'Cartão de débito';
  return 'Cartão';
}

// ── Traduzir motivo de recusa do MP ──
function traduzirMotivo(statusDetail) {
  const motivos = {
    'cc_rejected_bad_filled_card_number': 'Número do cartão inválido.',
    'cc_rejected_bad_filled_date':        'Data de vencimento inválida.',
    'cc_rejected_bad_filled_other':       'Dados do cartão incorretos.',
    'cc_rejected_bad_filled_security_code': 'Código de segurança inválido.',
    'cc_rejected_blacklist':              'Cartão bloqueado. Entre em contato com seu banco.',
    'cc_rejected_call_for_authorize':     'O banco solicitou autorização. Ligue para seu banco e tente novamente.',
    'cc_rejected_card_disabled':          'Cartão desabilitado. Entre em contato com seu banco.',
    'cc_rejected_card_error':             'Erro no cartão. Tente novamente ou use outro cartão.',
    'cc_rejected_duplicated_payment':     'Pagamento duplicado detectado.',
    'cc_rejected_high_risk':              'Pagamento recusado por medida de segurança. Tente outro cartão.',
    'cc_rejected_insufficient_amount':    'Saldo insuficiente no cartão.',
    'cc_rejected_invalid_installments':   'Número de parcelas inválido para este cartão.',
    'cc_rejected_max_attempts':           'Número máximo de tentativas atingido. Tente novamente amanhã.',
    'cc_rejected_other_reason':           'Pagamento recusado pelo banco.',
    'rejected_by_bank':                   'Pagamento recusado pelo banco.',
    'rejected_insufficient_data':         'Dados insuficientes para processar o pagamento.',
  };
  return motivos[statusDetail] || 'Pagamento não aprovado. Tente novamente ou use outro cartão.';
}

function montarMensagemWhatsAppConfirmacao(item, evento, formaPagamento) {
  const primeiroNome = (item.nome || 'Atleta').split(' ')[0];
  const dataEvento   = evento ? formatarData(evento.data, evento.hora) : '—';
  return (
    `🎽 *Inscrição confirmada, ${primeiroNome}!*\n\n` +
    `Sua inscrição na *JBX Sports* foi confirmada com sucesso. ✅\n\n` +
    `📋 *Detalhes da inscrição:*\n` +
    `• Evento: *${item.evento || '—'}*\n` +
    `• Data: *${dataEvento}*\n` +
    `• Modalidade: *${item.modalidade || '—'}*\n` +
    `• Kit: *${item.kit || '—'}*\n` +
    `• Camiseta: *${item.camisa || '—'}*\n` +
    `• Pagamento: *${formaPagamento || '—'}*\n\n` +
    `📍 Fique de olho nas nossas redes para informações sobre retirada de kit e concentração.\n\n` +
    `📸 *@jbx.sports*\n\n` +
    `Boa corrida! Vamos juntos! 🧡🏁`
  );
}

function montarMensagemWhatsAppRecusa(nome, eventoNome, motivo) {
  const primeiroNome = (nome || 'Atleta').split(' ')[0];
  return (
    `⚠️ *Pagamento não confirmado, ${primeiroNome}.*\n\n` +
    `Seu pagamento para o evento *${eventoNome || 'JBX Sports'}* não foi aprovado e sua inscrição *não foi realizada*.\n\n` +
    `❌ *Motivo:* ${motivo}\n\n` +
    `🔁 Você pode tentar novamente acessando o site:\n` +
    `👉 *${SITE_URL}*\n\n` +
    `Dicas:\n` +
    `• Confira os dados do cartão\n` +
    `• Tente outro cartão\n` +
    `• Verifique o limite disponível\n\n` +
    `Em caso de dúvidas, fale com a gente pelo Instagram:\n` +
    `📸 *@jbx.sports* 🧡`
  );
}

// ── Handler principal ──
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, data, action } = req.body;
  console.log('[mp-webhook] recebido — type:', type, '| action:', action, '| data:', JSON.stringify(data));

  let pedido         = null;
  let itens          = [];
  let eventoNome     = '';
  let formaPagamento = 'Cartão';

  try {
    // ── Notificação de pagamento ──
    if (type === 'payment' && data?.id) {
      const paymentClient = new Payment(mp);
      const payment = await paymentClient.get({ id: data.id });

      console.log('[mp-webhook] payment status:', payment.status, '| detail:', payment.status_detail, '| tipo:', payment.payment_type_id);

      const meta     = payment.metadata || {};
      pedido         = payment.external_reference;
      eventoNome     = meta.evento_nome || '';
      try { itens = JSON.parse(meta.itens || '[]'); } catch(e) {}

      // ── Pagamento RECUSADO ──
      if (payment.status === 'rejected') {
        const motivo = traduzirMotivo(payment.status_detail);
        console.log('[mp-webhook] pagamento recusado — pedido:', pedido, '| motivo:', motivo);

        // Deleta inscrições pendentes do banco
        if (pedido) await deletarInscricoesPedido(pedido);

        // Notifica cada atleta
        for (const item of itens) {
          if (item.tel)   await enviarWhatsApp(item.tel, montarMensagemWhatsAppRecusa(item.nome, eventoNome, motivo));
          if (item.email) await enviarEmailRecusa(item.email, item.nome, eventoNome, motivo);
        }

        return res.status(200).json({ received: true, status: 'rejected', motivo });
      }

      // ── Pagamento não aprovado nem recusado (pendente, em processamento) ──
      if (payment.status !== 'approved') {
        console.log('[mp-webhook] pagamento pendente/outro status:', payment.status);
        return res.status(200).json({ received: true, status: payment.status });
      }

      // ── Pagamento APROVADO ──
      formaPagamento = detectarFormaPagamento(payment);
    }

    // ── Notificação de merchant_order ──
    else if (type === 'merchant_order' && data?.id) {
      const orderClient = new MerchantOrder(mp);
      const order = await orderClient.get({ merchantOrderId: data.id });

      console.log('[mp-webhook] merchant_order status:', order.order_status);

      if (order.order_status !== 'paid') {
        return res.status(200).json({ received: true, status: order.order_status });
      }

      pedido     = order.external_reference;
      const meta = order.metadata || {};
      eventoNome = meta.evento_nome || '';
      try { itens = JSON.parse(meta.itens || '[]'); } catch(e) {}

      if (order.payments && order.payments.length > 0) {
        const p = order.payments[0];
        formaPagamento = detectarFormaPagamento({ payment_type_id: p.payment_type, payment_method_id: p.payment_method_id || '' });
      }
    }

    else {
      return res.status(200).json({ received: true });
    }

  } catch(e) {
    console.error('[mp-webhook] Erro ao buscar payment/order MP:', e.message);
    return res.status(500).json({ error: e.message });
  }

  if (!pedido) {
    console.warn('[mp-webhook] Pedido não encontrado no evento');
    return res.status(200).json({ received: true });
  }

  console.log('[mp-webhook] aprovado — pedido:', pedido, '| forma:', formaPagamento, '| itens:', itens.length);

  // Marca como pago com forma de pagamento real
  await marcarComoPago(pedido, formaPagamento);

  // Baixa o estoque dos produtos adicionais e auto-esgota os que atingiram o limite
  await baixarEstoque(pedido);

  // Busca dados do evento
  const evento     = await buscarEvento(eventoNome);
  const dataEvento = evento ? formatarData(evento.data, evento.hora) : '—';

  // Para cada atleta: WhatsApp + e-mail de confirmação
  for (const item of itens) {
    if (item.tel) await enviarWhatsApp(item.tel, montarMensagemWhatsAppConfirmacao(item, evento, formaPagamento));
    if (item.email) {
      const itemEmail = { ...item, tamanho_camisa: item.tamanho_camisa || item.camisa || '—' };
      await enviarEmailConfirmacao(item.email, item.nome, itemEmail, dataEvento);
    }
  }

  return res.status(200).json({ received: true, pedido, forma: formaPagamento, itens: itens.length });
};

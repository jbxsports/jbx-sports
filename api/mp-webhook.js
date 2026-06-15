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

// ── E-mail ──
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
  const tipo = (payment.payment_type_id || '').toLowerCase();
  const metodo = (payment.payment_method_id || '').toLowerCase();
  if (tipo === 'account_money') return 'Mercado Pago';
  if (tipo === 'bank_transfer' || metodo === 'pix') return 'PIX';
  if (tipo === 'credit_card') return 'Cartão de crédito';
  if (tipo === 'debit_card') return 'Cartão de débito';
  return 'Cartão';
}

function montarMensagemWhatsApp(item, evento, formaPagamento) {
  const primeiroNome = (item.nome || item.rotulo || 'Atleta').split(' ')[0];
  const dataEvento = evento ? formatarData(evento.data, evento.hora) : '—';
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

      console.log('[mp-webhook] payment status:', payment.status, '| tipo:', payment.payment_type_id, '| metodo:', payment.payment_method_id);

      if (payment.status !== 'approved') {
        return res.status(200).json({ received: true, status: payment.status });
      }

      pedido         = payment.external_reference;
      formaPagamento = detectarFormaPagamento(payment);
      const meta     = payment.metadata || {};
      eventoNome     = meta.evento_nome || '';
      try { itens = JSON.parse(meta.itens || '[]'); } catch(e) {}
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

      // Tenta pegar forma de pagamento do primeiro pagamento da order
      if (order.payments && order.payments.length > 0) {
        const p = order.payments[0];
        const tipoFake = { payment_type_id: p.payment_type, payment_method_id: p.payment_method_id || '' };
        formaPagamento = detectarFormaPagamento(tipoFake);
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

  console.log('[mp-webhook] processando pedido:', pedido, '| forma:', formaPagamento, '| itens:', itens.length);

  // Marca como pago com forma de pagamento real
  await marcarComoPago(pedido, formaPagamento);

  // Busca dados do evento
  const evento     = await buscarEvento(eventoNome);
  const dataEvento = evento ? formatarData(evento.data, evento.hora) : '—';

  // Para cada atleta: WhatsApp + e-mail
  for (const item of itens) {
    if (item.tel) await enviarWhatsApp(item.tel, montarMensagemWhatsApp(item, evento, formaPagamento));
    if (item.email) await enviarEmailConfirmacao(item.email, item.nome, item, dataEvento);
  }

  return res.status(200).json({ received: true, pedido, forma: formaPagamento, itens: itens.length });
};

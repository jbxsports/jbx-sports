// api/checkout.js — Mercado Pago Checkout Pro
const { MercadoPagoConfig, Preference } = require('mercadopago');

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL       = process.env.SITE_URL || 'https://jbx-sports.vercel.app';

async function buscarDadosAtleta(cpf) {
  try {
    const cpfLimpo = cpf.replace(/\D/g, '');

    const res = await fetch(`${SB_URL}/rest/v1/atletas_contas?cpf=eq.${cpfLimpo}&limit=1&select=nome,telefone,email`, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data = await res.json();
    if (data && data.length > 0 && data[0].telefone) return data[0];

    const res2 = await fetch(`${SB_URL}/rest/v1/inscricoes?cpf=eq.${cpfLimpo}&telefone=not.is.null&order=id.desc&limit=1&select=nome,telefone,email`, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data2 = await res2.json();
    if (data2 && data2.length > 0) return data2[0];

  } catch(e) {
    console.error('[checkout] buscarDadosAtleta erro:', e.message);
  }
  return null;
}

async function criarInscricoes(itens, pedido, cupom, formaPagamento, eventoNome) {
  const resultados = [];
  for (const item of itens) {
    try {
      const dados = {
        pedido, evento: eventoNome || '',
        evento_id:           item.evento_id           || '',
        ref:                 item.ref                 || '',
        cpf:                 item.cpf                 || '',
        kit_id:              item.kit_id              || '',
        lote_id:             item.lote_id             || '',
        kit:                 item.kit                 || '',
        modalidade:          item.modalidade          || '',
        tamanho_camisa:      item.tamanho_camisa      || '',
        cupom:               cupom                    || '',
        forma_pagamento:     formaPagamento           || 'cartao',
        nome:                item.nome                || '',
        nascimento:          item.nascimento          || '',
        genero:              item.genero              || '',
        email:               item.email               || '',
        telefone:            item.telefone            || '',
        cep:                 item.cep                 || '',
        rua:                 item.rua                 || '',
        numero:              item.numero              || '',
        complemento:         item.complemento         || '',
        bairro:              item.bairro              || '',
        cidade:              item.cidade              || '',
        estado:              item.estado              || '',
        emergencia_nome:     item.emergencia_nome     || '',
        emergencia_telefone: item.emergencia_telefone || '',
        valor:               item.valor               || 0,
        valor_inscricao:     item.valor_inscricao     || '',
        produtos:            Array.isArray(item.produtos) ? item.produtos : [],
      };

      const res = await fetch(`${SB_URL}/rest/v1/rpc/criar_inscricao`, {
        method: 'POST',
        headers: {
          'apikey':        SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ dados })
      });

      const text = await res.text();
      console.log('[checkout] criar_inscricao status:', res.status, text);

      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).message || JSON.parse(text).error || text; } catch(e){}
        resultados.push({ ok: false, erro: msg });
        continue;
      }

      resultados.push({ ok: true, valor_cents: Math.round(item.valor * 100) });
    } catch(e) {
      resultados.push({ ok: false, erro: e.message });
    }
  }
  return resultados;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

  // LOG TEMPORÁRIO — remover após diagnóstico
  const token = process.env.MP_ACCESS_TOKEN || '';
  console.log('[checkout] TOKEN prefixo:', token.slice(0, 15), '| tamanho:', token.length);

  if (!itens || !itens.length) {
    return res.status(400).json({ error: 'Nenhum item no pedido.' });
  }

  // Cria inscrições no Supabase
  const resultados = await criarInscricoes(itens, pedido, cupom, forma_pagamento, evento_nome);
  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  const totalCents = resultados.reduce((acc, r) => acc + (r.valor_cents || 0), 0);
  if (totalCents <= 0) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }

  // Monta metadados dos atletas (para o webhook usar)
  const metadataItens = await Promise.all(itens.map(async (it) => {
    let nome     = it.nome     || '';
    let telefone = it.telefone || '';
    let email    = it.email    || '';

    if (it.cpf && (!telefone || !email)) {
      const dadosBanco = await buscarDadosAtleta(it.cpf);
      if (dadosBanco) {
        nome     = nome     || dadosBanco.nome     || '';
        telefone = telefone || dadosBanco.telefone || '';
        email    = email    || dadosBanco.email    || '';
      }
    }

    console.log('[checkout] item final — nome:', nome, '| tel:', telefone, '| email:', email);

    return {
      nome:       nome.slice(0, 40),
      tel:        (telefone || '').replace(/[^0-9]/g, '').slice(0, 15),
      email:      email.slice(0, 60),
      evento:     (evento_nome || '').slice(0, 40),
      kit:        (it.kit || '').slice(0, 20),
      modalidade: (it.modalidade || '').slice(0, 20),
      camisa:     (it.tamanho_camisa || '').slice(0, 10),
      valor:      it.valor || 0,
    };
  }));

  // Monta itens da preferência MP
  const mpItems = itens.map((item, i) => ({
    id:          `${pedido}-${i}`,
    title:       `${item.kit || 'Kit'} — ${item.modalidade || ''} (${item.nome || 'Atleta'})`,
    description: evento_nome || 'JBX Sports',
    quantity:    1,
    unit_price:  item.valor,
    currency_id: 'BRL',
  }));

  try {
    const preference = new Preference(mp);
    const response = await preference.create({
      body: {
        items: mpItems,
        external_reference: pedido,
        metadata: {
          pedido,
          evento_nome: evento_nome || '',
          cupom:       cupom       || '',
          itens:       JSON.stringify(metadataItens),
        },
        payment_methods: {
          // PIX + Cartão de crédito
          excluded_payment_types: [
            { id: 'ticket' },      // boleto
            { id: 'debit_card' },  // débito
          ],
        },
        back_urls: {
          success: `${SITE_URL}/atleta.html?pedido=${pedido}`,
          failure: `${SITE_URL}/?status=cancelado`,
          pending: `${SITE_URL}/atleta.html?pedido=${pedido}&status=pendente`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/api/mp-webhook`,
        statement_descriptor: 'JBX SPORTS',
      }
    });

    console.log('[checkout] Preferência MP criada:', response.id);
    return res.status(200).json({ url: response.init_point });

  } catch(e) {
    console.error('[checkout] Mercado Pago error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

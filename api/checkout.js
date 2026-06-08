// api/checkout.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Busca dados do atleta pelo CPF no banco (para atletas com ref) ──
async function buscarDadosAtleta(cpf) {
  try {
    const cpfLimpo = cpf.replace(/\D/g, '');
    // Busca em inscricoes (mais recente)
    const res = await fetch(`${SB_URL}/rest/v1/inscricoes?cpf=eq.${cpfLimpo}&order=id.desc&limit=1&select=nome,telefone,email`, {
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`
      }
    });
    const data = await res.json();
    if (data && data.length > 0) return data[0];

    // Tenta em atletas_contas
    const res2 = await fetch(`${SB_URL}/rest/v1/atletas_contas?cpf=eq.${cpfLimpo}&limit=1&select=nome,telefone,email`, {
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`
      }
    });
    const data2 = await res2.json();
    if (data2 && data2.length > 0) return data2[0];
  } catch(e) {
    console.error('[checkout] buscarDadosAtleta erro:', e.message);
  }
  return null;
}

// ── Cria inscrições no Supabase ──
async function criarInscricoes(itens, pedido, cupom, formaPagamento, eventoNome) {
  const resultados = [];
  for (const item of itens) {
    try {
      const dados = {
        pedido, evento: eventoNome || '',
        ref:           item.ref        || '',
        cpf:           item.cpf        || '',
        kit_id:        item.kit_id     || '',
        lote_id:       item.lote_id    || '',
        kit:           item.kit        || '',
        modalidade:    item.modalidade || '',
        tamanho_camisa:item.tamanho_camisa || '',
        cupom:         cupom           || '',
        forma_pagamento: formaPagamento || 'cartao',
        nome:          item.nome       || '',
        nascimento:    item.nascimento || '',
        genero:        item.genero     || '',
        email:         item.email      || '',
        telefone:      item.telefone   || '',
        cep:           item.cep        || '',
        rua:           item.rua        || '',
        numero:        item.numero     || '',
        complemento:   item.complemento|| '',
        bairro:        item.bairro     || '',
        cidade:        item.cidade     || '',
        estado:        item.estado     || '',
        emergencia_nome:     item.emergencia_nome      || '',
        emergencia_telefone: item.emergencia_telefone  || '',
        valor:         item.valor      || 0,
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { itens, pedido, cupom, forma_pagamento, evento_nome } = req.body;

  if (!itens || !itens.length) {
    return res.status(400).json({ error: 'Nenhum item no pedido.' });
  }

  // ── 1. Cria inscrições no Supabase ──
  const resultados = await criarInscricoes(itens, pedido, cupom, forma_pagamento, evento_nome);
  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  // ── 2. Total em centavos ──
  const totalCents = resultados.reduce((acc, r) => acc + (r.valor_cents || 0), 0);
  if (totalCents <= 0) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }

  // ── 3. Line items para o Stripe ──
  const line_items = itens.map((item, i) => ({
    price_data: {
      currency: 'brl',
      product_data: {
        name: `${item.kit || 'Kit'} — ${item.modalidade || ''} (${item.nome || item.rotulo || 'Atleta'})`,
        description: evento_nome || '',
      },
      unit_amount: resultados[i].valor_cents,
    },
    quantity: 1,
  }));

  // ── 4. Metadados para o webhook ──
  // Para atletas com ref (cadastro existente), busca telefone/email/nome do banco
  const metadataItens = await Promise.all(itens.map(async (it) => {
    let nome     = it.nome     || '';
    let telefone = it.telefone || '';
    let email    = it.email    || '';

    // Se veio por ref (atleta já cadastrado), busca dados reais no banco
    if (it.ref && it.cpf && (!telefone || !nome)) {
      const dadosBanco = await buscarDadosAtleta(it.cpf);
      if (dadosBanco) {
        nome     = nome     || dadosBanco.nome     || '';
        telefone = telefone || dadosBanco.telefone || '';
        email    = email    || dadosBanco.email    || '';
      }
    }

    return {
      ref:            it.ref           || '',
      cpf:            it.cpf           || '',
      nome,
      telefone,
      email,
      evento:         evento_nome      || '',
      kit:            it.kit           || '',
      modalidade:     it.modalidade    || '',
      tamanho_camisa: it.tamanho_camisa|| '',
    };
  }));

  console.log('[checkout] metadataItens:', JSON.stringify(metadataItens));

  // ── 5. Método de pagamento ──
  const payment_method_types = forma_pagamento === 'pix' ? ['pix'] : ['card'];

  // ── 6. Cria sessão no Stripe ──
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types,
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL || 'https://jbx-sports.vercel.app'}/atleta.html?pedido=${pedido}`,
      cancel_url:  `${process.env.SITE_URL || 'https://jbx-sports.vercel.app'}/?status=cancelado`,
      metadata: {
        pedido,
        evento_nome: evento_nome || '',
        cupom:       cupom       || '',
        itens:       JSON.stringify(metadataItens).slice(0, 500),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch(e) {
    console.error('[checkout] Stripe error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

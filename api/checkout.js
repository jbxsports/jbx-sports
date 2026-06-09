// api/checkout.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SB_URL         = 'https://acxfzdtzxaahsqnlxdgw.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function buscarDadosAtleta(cpf) {
  try {
    const cpfLimpo = cpf.replace(/\D/g, '');

    // Busca direto em atletas_contas (fonte mais confiável)
    const res = await fetch(`${SB_URL}/rest/v1/atletas_contas?cpf=eq.${cpfLimpo}&limit=1&select=nome,telefone,email`, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data = await res.json();
    if (data && data.length > 0 && data[0].telefone) return data[0];

    // Fallback: inscricoes com telefone não nulo
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

  const resultados = await criarInscricoes(itens, pedido, cupom, forma_pagamento, evento_nome);
  const erros = resultados.filter(r => !r.ok);
  if (erros.length) {
    return res.status(400).json({ error: erros[0].erro || 'Erro ao criar inscrição.' });
  }

  const totalCents = resultados.reduce((acc, r) => acc + (r.valor_cents || 0), 0);
  if (totalCents <= 0) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }

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

  const metadataItens = await Promise.all(itens.map(async (it) => {
    let nome     = it.nome     || '';
    let telefone = it.telefone || '';
    let email    = it.email    || '';

    // Busca dados no banco se telefone ou email estiver vazio
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
      tel:        (telefone || '').replace(/\D/g, '').slice(0, 15),
      email:      email.slice(0, 60),
      evento:     (evento_nome || '').slice(0, 40),
      kit:        (it.kit || '').slice(0, 20),
      modalidade: (it.modalidade || '').slice(0, 20),
      camisa:     (it.tamanho_camisa || '').slice(0, 10),
      valor:      it.valor || 0,
    };
  }));

  const itensJson = JSON.stringify(metadataItens);
  console.log('[checkout] metadataItens final:', itensJson);

  const payment_method_types = forma_pagamento === 'pix' ? ['pix'] : ['card'];

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
        itens:       itensJson,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch(e) {
    console.error('[checkout] Stripe error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

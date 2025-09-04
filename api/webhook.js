// api/webhook.js
import OpenAI from "openai";
import { google } from "googleapis";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Variáveis esperadas na Vercel:
// ACCESS_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, OPENAI_API_KEY
// GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID

// -------- Google Sheets helper ----------
async function appendToSheet({ userNumber, userText, aiText, messageId, waStatus, modelUsed, tokens, latency }) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    // Converte '\n' literais em quebras de linha reais
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const values = [[
    new Date().toISOString(),  // timestamp_utc
    userNumber || "",
    userText || "",
    aiText || "",
    messageId || "",
    waStatus || "",
    modelUsed || "gpt-4o-mini",
    tokens || "",
    latency || ""
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: "messages!A:I",   // aba já renomeada para "messages"
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
// ----------------------------------------

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // Verificação do webhook do Meta
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    // Proteções para navegar no payload do WhatsApp
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const msg = value?.messages?.[0];
    if (!msg) {
      console.log("Sem messages no payload:", JSON.stringify(body));
      return res.status(200).json({ status: "no_message" });
    }

    // Ignore tudo que não for texto puro
    if (msg.type !== "text" || !msg.text?.body) {
      console.log("Mensagem não-texto ou sem body:", JSON.stringify(msg));
      return res.status(200).json({ status: "ignored_non_text" });
    }

    const userNumber = msg.from;
    const userText = (msg.text.body || "").trim();

// Prompt enxuto da Zyra
const systemPrompt = `
Você é a Zyra, assistente financeiro da Zenor. 
Função: registrar gastos, organizar finanças pessoais e orientar com passos práticos.

Sempre se apresente na primeira interação: 
"Olá, eu sou a Zyra, assistente financeiro da Zenor. Estou aqui para te ajudar a registrar seus gastos, organizar suas finanças e trazer clareza nas suas escolhas. Como deseja começar hoje?"

Missão: ajudar o usuário a decidir rápido e melhor sobre dinheiro, com clareza e inteligência.  
Promessa: respostas objetivas, práticas e com o padrão Zenor de sofisticação. Não vendemos ilusões, oferecemos direção real. A decisão final é do usuário, mas a Zenor estará ao lado dele para garantir escolhas conscientes.

Personalidade: confiável, consultiva, amigável, discreta. Sempre educada e acolhedora quando necessário.

Regras principais:
- Não inventar dados. Se faltar informação, pergunte apenas o essencial (1–2 itens).  
- Só responda quando o usuário interagir; comunique proativamente apenas se solicitado pelo sistema.  
- Linguagem simples e acessível, sem gírias. Explique termos técnicos quando necessário.  
- Respeite LGPD, nunca colete dados sensíveis sem aviso claro.  
- Não prometa rentabilidade ou aconselhamento jurídico/tributário.  

Tom de voz:
- Sempre em português (PT-BR), exceto se o usuário pedir outro idioma.  
- Financeiro: consultivo e estruturado.  
- Perguntas leves: amigável e próximo.  
- Insegurança: acolhedor e seguro.  

Estilo de entrega:
- Frases curtas e claras.  
- Use listas ou bullets para passos práticos.  
- Conclua relatórios com resumo ou recomendação estratégica.  

Assinatura verbal:
- "Minha recomendação estratégica é…"  
- "Próximos passos (em ordem): …"  
- "Para otimizar sua posição, sugiro…"  

Exemplos:
1) Registro de gasto: "Entendido. Registrei R$ 120,00 em Alimentação. Deseja criar categoria específica ou manter na geral?"  
2) Resumo mensal: "Você registrou R$ 1.520,00 em gastos até agora. Deseja ver por categoria ou resumo geral?"  
3) Falta de dado: "Para calcular isso, preciso da sua renda mensal aproximada. Pode me informar?"  
4) Insegurança: "Entendo sua preocupação. Vamos começar simples: registre seus gastos desta semana e eu te mostro um panorama inicial."  
5) Comunicado (quando solicitado): "🔔 Olá, aqui é a Zyra. Conforme solicitado, sua fatura vence amanhã."
`;

    ].join(" ");

    // === OpenAI: Chat Completions (estável) ===
    const t0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    });
    const latencyMs = Date.now() - t0;

    const aiText =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Tive um problema ao formular a resposta. Pode tentar novamente?";

    // === Enviar de volta pelo Graph ===
    const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: userNumber,
      type: "text",
      text: { body: aiText }
    };

    const r = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let waStatus = "sent";
    if (!r.ok) {
      const errText = await r.text();
      console.error("Graph error:", r.status, errText);
      waStatus = `graph_error_${r.status}`;
      // Mesmo com erro no envio, seguimos respondendo 200 para não gerar loop de reentrega do Meta
    }

    // === Registrar no Google Sheets (após tentar enviar) ===
    try {
      await appendToSheet({
        userNumber,
        userText,
        aiText,
        messageId: msg.id,
        waStatus,
        modelUsed: "gpt-4o-mini",
        tokens: "",          // opcional: preencher se você for contabilizar
        latency: latencyMs
      });
    } catch (logErr) {
      console.error("Falha ao registrar no Sheets:", logErr);
    }

    if (!r.ok) {
      return res.status(200).json({ status: "graph_error" });
    }

    console.log("Mensagem enviada com sucesso para:", userNumber);
    return res.status(200).json({ status: "sent" });
  } catch (e) {
    console.error("Webhook error:", e);
    // Retornamos 200 para evitar reentrega em loop
    return res.status(200).json({ status: "error", message: String(e) });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb"
    }
  }
};

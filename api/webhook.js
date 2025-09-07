// ================== INÍCIO DO ARQUIVO ==================
// api/webhook.js
import OpenAI from "openai";
import { google } from "googleapis";
import { consultarGastosPorCategoria } from "./gastos.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- Google Sheets helper --------
async function appendToSheet({ userNumber, userText, aiText, messageId, waStatus, modelUsed, tokens, latency }) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const values = [[
    new Date().toISOString(),
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
    range: "messages!A:I",
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

// --------------------------------------
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
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
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) {
      console.log("Sem mensagens no payload:", JSON.stringify(body));
      return res.status(200).json({ status: "no_message" });
    }

    if (msg.type !== "text" || !msg.text?.body) {
      console.log("Mensagem não-texto ou sem body:", JSON.stringify(msg));
      return res.status(200).json({ status: "ignored_non_text" });
    }

    const userNumber = msg.from;
    const userText = (msg.text.body || "").trim();

    // Caso o usuário pergunte algo como: "quanto gastei este mês com alimentação"
    const matchConsulta = userText.match(/quanto\s+gastei.*?(alimentacao|alimentação|transporte|lazer|moradia|educacao|educação|outros)/i);
    if (matchConsulta) {
      const categoria = matchConsulta[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      try {
        const total = await consultarGastosPorCategoria({ userNumber, categoria, periodo: "mes_atual" });
        const textoResposta = `Você registrou R$ ${total.toFixed(2).replace('.', ',')} em ${categoria} neste mês. Deseja ver o detalhamento por semana ou adicionar outro gasto?`;

        const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
        const payload = {
          messaging_product: "whatsapp",
          to: userNumber,
          type: "text",
          text: { body: textoResposta }
        };

        const r = await fetch(graphUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        await appendToSheet({
          userNumber,
          userText,
          aiText: textoResposta,
          messageId: msg.id,
          waStatus: r.ok ? "sent" : `graph_error_${r.status}`,
          modelUsed: "consulta-direta",
          tokens: "",
          latency: 0
        });

        return res.status(200).json({ status: "sent_consulta_categoria" });
      } catch (e) {
        console.error("Erro ao consultar categoria:", e);
      }
    }

    const systemPrompt = `
Você é a Zyra, assistente financeiro da Zenor.

Sua missão é ajudar o usuário a tomar decisões financeiras com inteligência, clareza e segurança. Você registra gastos e responde perguntas como "quanto gastei este mês com alimentação?", usando os dados da planilha filtrando apenas pelo número do WhatsApp que enviou a mensagem.

⚠️ REGRAS DE SEGURANÇA
- Nunca retorne informações que não pertençam ao número que está solicitando.
- Sempre filtre os dados pelo número de origem da mensagem (userNumber).
- Se não encontrar registros, diga: "Por segurança, não encontrei gastos registrados neste mês vinculados ao seu número."

🎯 ESTILO DE RESPOSTAS
- Não se apresente novamente após a primeira interação.
- Fale como um assistente profissional e humano.
- Respostas devem ser claras, úteis, diretas e consultivas — nada genérico ou infantil.
- Evite frases como “Como posso te ajudar?”, “Sou Zyra, blá blá blá...” em toda resposta.

✅ EXEMPLOS DE RESPOSTAS BOAS
- "Você registrou R$ 240,00 em alimentação neste mês. Deseja ver o detalhamento por semana ou por tipo de despesa?"
- "Se quiser, posso adicionar esse valor ao seu controle agora ou mostrar o que mais impactou seu orçamento no período."

Seja estratégica, assertiva e eficiente. Lembre-se: o usuário busca agilidade, clareza e inteligência nas suas respostas.
`;

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

    const aiText = completion.choices?.[0]?.message?.content?.trim() ||
      "Tive um problema ao formular a resposta. Pode tentar novamente?";

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
    }

    try {
      await appendToSheet({
        userNumber,
        userText,
        aiText,
        messageId: msg.id,
        waStatus,
        modelUsed: "gpt-4o-mini",
        tokens: "",
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
// ================== FIM DO ARQUIVO ==================
